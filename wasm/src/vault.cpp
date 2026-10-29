// MSFS-UI vault: stores the mod's data in two files of the package's `work` folder, alternately, so that a write
// interrupted at any point leaves the previous snapshot readable. It works on a CommBus message or an I/O callback
// only: no per-frame work, no timer. The protocol and the file format are in wasm/README.md.

#include <MSFS/MSFS.h>
#include <MSFS/MSFS_CommBus.h>
#include <MSFS/MSFS_IO.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define EVENT_LOAD "MSFS_UI_VAULT_LOAD"
#define EVENT_SAVE "MSFS_UI_VAULT_SAVE"
#define EVENT_LOADED "MSFS_UI_VAULT_LOADED"
#define EVENT_SAVED "MSFS_UI_VAULT_SAVED"

static const int MAX_TEXT = 524288;
static const int HEAD_SIZE = 64;
static const char* const DATA_PATH[2] = {"/work/vault-a.data", "/work/vault-b.data"};
static const char* const HEAD_PATH[2] = {"/work/vault-a.head", "/work/vault-b.head"};
static const FsCommBusBroadcastFlags TO_JS = FsCommBusBroadcast_JS;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

static unsigned int fnv1a(const char* data, int length) {
  unsigned int hash = 2166136261u;
  for (int i = 0; i < length; i++) {
    hash ^= (unsigned char)data[i];
    hash *= 16777619u;
  }
  return hash;
}

// A text copied from a bus buffer: trailing NULs (a C string sent with its terminator) are dropped.
static int trimmedSize(const char* buf, unsigned int size) {
  int length = (int)size;
  while (length > 0 && buf[length - 1] == 0) length--;
  return length;
}

static char* copyOf(const char* buf, int length) {
  char* copy = (char*)malloc((size_t)length + 1);
  if (copy == nullptr) return nullptr;
  if (length > 0) memcpy(copy, buf, (size_t)length);
  copy[length] = 0;
  return copy;
}

// Parses `digits` of a fixed width in the given base; false when a character is not a digit.
static bool parseNumber(const char* text, int width, int base, unsigned long long* out) {
  unsigned long long value = 0;
  for (int i = 0; i < width; i++) {
    char c = text[i];
    int digit;
    if (c >= '0' && c <= '9') digit = c - '0';
    else if (base == 16 && c >= 'a' && c <= 'f') digit = c - 'a' + 10;
    else return false;
    value = value * (unsigned)base + (unsigned)digit;
  }
  *out = value;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

struct Snapshot {
  unsigned int seq;
  char* text; // NUL-terminated copy
  int length;
};

static Snapshot* g_loaded = nullptr;   // the newest snapshot known to be on the disk
static int g_loadedSlot = -1;          // its slot; -1 when none
static Snapshot* g_inflight = nullptr; // being written
static Snapshot* g_queued = nullptr;   // waiting for the write to end; a newer SAVE replaces it
static int g_inflightSlot = 0;
static unsigned int g_acceptedSeq = 0; // the highest seq accepted so far
static bool g_ready = false;           // the start-up read has ended

// Seqs accepted and not answered yet (the inflight one, the queued one and the ones it replaced).
static unsigned int* g_acks = nullptr;
static int g_ackCount = 0;
static int g_ackCapacity = 0;

static char g_head[HEAD_SIZE];

static void freeSnapshot(Snapshot* snapshot) {
  if (snapshot == nullptr) return;
  free(snapshot->text);
  free(snapshot);
}

static Snapshot* latest() {
  if (g_queued != nullptr) return g_queued;
  if (g_inflight != nullptr) return g_inflight;
  return g_loaded;
}

static void send(const char* event, const char* data, int length) {
  fsCommBusCall(event, data, (unsigned int)length, TO_JS);
}

static void reply(unsigned int seq, const char* status) {
  char line[64];
  int length = snprintf(line, sizeof line, "%u\n%s", seq, status);
  send(EVENT_SAVED, line, length);
}

static void addAck(unsigned int seq) {
  if (g_ackCount == g_ackCapacity) {
    int capacity = g_ackCapacity == 0 ? 8 : g_ackCapacity * 2;
    unsigned int* grown = (unsigned int*)realloc(g_acks, sizeof(unsigned int) * (size_t)capacity);
    if (grown == nullptr) return;
    g_acks = grown;
    g_ackCapacity = capacity;
  }
  g_acks[g_ackCount++] = seq;
}

// Answers every pending seq up to `upTo`.
static void answerAcks(unsigned int upTo, const char* status) {
  int kept = 0;
  for (int i = 0; i < g_ackCount; i++) {
    if (g_acks[i] <= upTo) reply(g_acks[i], status);
    else g_acks[kept++] = g_acks[i];
  }
  g_ackCount = kept;
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing: data, close, head, close, answer

static void startWrite();

static void finishWrite(FsIOErr error) {
  Snapshot* done = g_inflight;
  g_inflight = nullptr;
  if (error == FsIOErr_Success) {
    freeSnapshot(g_loaded);
    g_loaded = done;
    g_loadedSlot = g_inflightSlot;
    answerAcks(done->seq, "ok");
  } else {
    char status[32];
    snprintf(status, sizeof status, "error %u", (unsigned)error);
    answerAcks(done->seq, status);
    freeSnapshot(done);
    // The failed seq is free again: the stale threshold follows what LOAD reports (a queued newer save keeps its own).
    if (g_queued == nullptr) g_acceptedSeq = g_loaded == nullptr ? 0 : g_loaded->seq;
  }
  if (g_queued != nullptr) startWrite();
}

static void failWrite(FsIOFile file, FsIOErr error) {
  if (error == FsIOErr_Success) error = FsIOErr_UnknownError;
  if (file != FS_IO_ERROR_FILE) fsIOClose(file);
  finishWrite(error);
}

static void onHeadWritten(FsIOFile file, const char* buf, int offset, int written, void* user) {
  if (written != HEAD_SIZE) {
    failWrite(file, fsIOGetLastError(file));
    return;
  }
  fsIOClose(file);
  finishWrite(FsIOErr_Success);
}

static void onHeadOpened(FsIOFile file, void* user) {
  FsIOErr error = fsIOWrite(file, g_head, 0, HEAD_SIZE, onHeadWritten, nullptr);
  if (error != FsIOErr_Success) failWrite(file, error);
}

static void openHead() {
  FsIOFile file = fsIOOpen(HEAD_PATH[g_inflightSlot], FsIOOpenFlag_WRONLY | FsIOOpenFlag_CREAT | FsIOOpenFlag_TRUNC, onHeadOpened, nullptr);
  if (file == FS_IO_ERROR_FILE) failWrite(file, FsIOErr_FileNotOpened);
}

static void onDataWritten(FsIOFile file, const char* buf, int offset, int written, void* user) {
  if (written != g_inflight->length) {
    failWrite(file, fsIOGetLastError(file));
    return;
  }
  fsIOClose(file);
  openHead();
}

static void onDataOpened(FsIOFile file, void* user) {
  if (g_inflight->length == 0) { // nothing to write: the file is created empty by the open
    fsIOClose(file);
    openHead();
    return;
  }
  FsIOErr error = fsIOWrite(file, g_inflight->text, 0, g_inflight->length, onDataWritten, nullptr);
  if (error != FsIOErr_Success) failWrite(file, error);
}

// Starts writing the queued snapshot into the slot that does not hold the newest valid one.
static void startWrite() {
  g_inflight = g_queued;
  g_queued = nullptr;
  g_inflightSlot = g_loadedSlot == 0 ? 1 : 0;
  memset(g_head, ' ', sizeof g_head);
  int length = snprintf(g_head, sizeof g_head, "MSFSUI-VAULT 1 %010u %010u %08x", g_inflight->seq, (unsigned)g_inflight->length,
                        fnv1a(g_inflight->text, g_inflight->length));
  g_head[length] = ' ';
  g_head[HEAD_SIZE - 1] = '\n';
  FsIOFile file = fsIOOpen(DATA_PATH[g_inflightSlot], FsIOOpenFlag_WRONLY | FsIOOpenFlag_CREAT | FsIOOpenFlag_TRUNC, onDataOpened, nullptr);
  if (file == FS_IO_ERROR_FILE) failWrite(file, FsIOErr_FileNotOpened);
}

// ---------------------------------------------------------------------------------------------------------------------
// Messages

static void handleLoad(const char* buf, int length) {
  Snapshot* snapshot = latest();
  unsigned int seq = snapshot == nullptr ? 0 : snapshot->seq;
  int textLength = snapshot == nullptr ? 0 : snapshot->length;
  int capacity = length + textLength + 16;
  char* out = (char*)malloc((size_t)capacity);
  if (out == nullptr) return;
  int used = 0;
  if (length > 0) memcpy(out, buf, (size_t)length);
  used += length;
  used += snprintf(out + used, (size_t)capacity - (size_t)used, "\n%u\n", seq);
  if (textLength > 0) memcpy(out + used, snapshot->text, (size_t)textLength);
  used += textLength;
  send(EVENT_LOADED, out, used);
  free(out);
}

static void handleSave(const char* buf, int length) {
  int split = 0;
  while (split < length && buf[split] != '\n') split++;
  if (split == length || split == 0 || split > 10) return; // no seq to answer to
  unsigned long long parsed = 0;
  for (int i = 0; i < split; i++) {
    if (buf[i] < '0' || buf[i] > '9') return;
    parsed = parsed * 10 + (unsigned)(buf[i] - '0');
  }
  if (parsed > 4294967295ull) return;
  unsigned int seq = (unsigned int)parsed;
  int textLength = length - split - 1;

  if (seq <= g_acceptedSeq) {
    reply(seq, "stale");
    return;
  }
  if (textLength > MAX_TEXT) {
    reply(seq, "too-big");
    return;
  }
  Snapshot* snapshot = (Snapshot*)malloc(sizeof(Snapshot));
  char* text = snapshot == nullptr ? nullptr : copyOf(buf + split + 1, textLength);
  if (text == nullptr) {
    free(snapshot);
    reply(seq, "error 4294967295");
    return;
  }
  snapshot->seq = seq;
  snapshot->text = text;
  snapshot->length = textLength;
  g_acceptedSeq = seq;
  addAck(seq);
  freeSnapshot(g_queued); // replaced: its seq stays in g_acks and is answered when this one is written
  g_queued = snapshot;
  if (g_inflight == nullptr) startWrite();
}

// Messages received before the start-up read ends, answered in order when it ends.
struct Deferred {
  bool isSave;
  char* data;
  int length;
};
static Deferred* g_deferred = nullptr;
static int g_deferredCount = 0;
static int g_deferredCapacity = 0;

static void dispatch(bool isSave, const char* buf, unsigned int size) {
  int length = trimmedSize(buf, size);
  if (!g_ready) {
    if (g_deferredCount == g_deferredCapacity) {
      int capacity = g_deferredCapacity == 0 ? 4 : g_deferredCapacity * 2;
      Deferred* grown = (Deferred*)realloc(g_deferred, sizeof(Deferred) * (size_t)capacity);
      if (grown == nullptr) return;
      g_deferred = grown;
      g_deferredCapacity = capacity;
    }
    char* copy = copyOf(buf, length);
    if (copy == nullptr) return;
    g_deferred[g_deferredCount++] = Deferred{isSave, copy, length};
    return;
  }
  if (isSave) handleSave(buf, length);
  else handleLoad(buf, length);
}

static void onLoad(const char* buf, unsigned int size, void* ctx) { dispatch(false, buf, size); }
static void onSave(const char* buf, unsigned int size, void* ctx) { dispatch(true, buf, size); }

// ---------------------------------------------------------------------------------------------------------------------
// Start-up read: both heads, then the data of each valid head; the newest slot whose checksum matches wins.

struct Slot {
  int index;
  bool headValid;
  unsigned int seq;
  int length;
  unsigned int hash;
  char* data;
  bool dataValid;
};
static Slot g_slots[2] = {{0, false, 0, 0, 0, nullptr, false}, {1, false, 0, 0, 0, nullptr, false}};
static int g_startupPending = 0;
static int g_startupPhase = 0; // 1: heads, 2: data

static void startupDataPhase();

static void finishStartup() {
  Slot* winner = nullptr;
  for (int i = 0; i < 2; i++) {
    if (g_slots[i].dataValid && (winner == nullptr || g_slots[i].seq > winner->seq)) winner = &g_slots[i];
  }
  for (int i = 0; i < 2; i++) {
    if (&g_slots[i] != winner) free(g_slots[i].data);
  }
  if (winner != nullptr) {
    g_loaded = (Snapshot*)malloc(sizeof(Snapshot));
    if (g_loaded != nullptr) {
      g_loaded->seq = winner->seq;
      g_loaded->text = winner->data;
      g_loaded->length = winner->length;
      g_loadedSlot = winner->index;
      g_acceptedSeq = winner->seq;
    } else {
      free(winner->data);
    }
  }
  g_ready = true;
  int count = g_deferredCount;
  Deferred* deferred = g_deferred;
  g_deferred = nullptr;
  g_deferredCount = 0;
  g_deferredCapacity = 0;
  for (int i = 0; i < count; i++) {
    if (deferred[i].isSave) handleSave(deferred[i].data, deferred[i].length);
    else handleLoad(deferred[i].data, deferred[i].length);
    free(deferred[i].data);
  }
  free(deferred);
}

static void endStartupOperation() {
  if (--g_startupPending > 0) return;
  if (g_startupPhase == 1) startupDataPhase();
  else finishStartup();
}

static void onHeadRead(FsIOFile file, char* buf, int offset, int read, void* user) {
  Slot* slot = (Slot*)user;
  if (read == HEAD_SIZE && memcmp(buf, "MSFSUI-VAULT 1 ", 15) == 0 && buf[25] == ' ' && buf[36] == ' ' && buf[45] == ' ' &&
      buf[HEAD_SIZE - 1] == '\n') {
    unsigned long long seq, length, hash;
    if (parseNumber(buf + 15, 10, 10, &seq) && parseNumber(buf + 26, 10, 10, &length) && parseNumber(buf + 37, 8, 16, &hash) &&
        seq <= 4294967295ull && length <= (unsigned long long)MAX_TEXT) {
      slot->headValid = true;
      slot->seq = (unsigned int)seq;
      slot->length = (int)length;
      slot->hash = (unsigned int)hash;
    }
  }
  fsIOClose(file);
  endStartupOperation();
}

static void onDataRead(FsIOFile file, char* buf, int offset, int read, void* user) {
  Slot* slot = (Slot*)user;
  if (read == slot->length) {
    memcpy(slot->data, buf, (size_t)read);
    slot->data[read] = 0;
    slot->dataValid = fnv1a(slot->data, read) == slot->hash;
  }
  fsIOClose(file); // the buffer `buf` belongs to the sim
  endStartupOperation();
}

static void startupDataPhase() {
  g_startupPhase = 2;
  g_startupPending = 1; // guard: the phase ends only after every read is launched
  for (int i = 0; i < 2; i++) {
    Slot* slot = &g_slots[i];
    if (!slot->headValid) continue;
    slot->data = (char*)malloc((size_t)slot->length + 1);
    if (slot->data == nullptr) continue;
    slot->data[0] = 0;
    if (slot->length == 0) {
      slot->dataValid = slot->hash == fnv1a("", 0);
      continue;
    }
    g_startupPending++;
    if (fsIOOpenRead(DATA_PATH[i], FsIOOpenFlag_RDONLY, 0, slot->length, onDataRead, slot) == FS_IO_ERROR_FILE) g_startupPending--;
  }
  endStartupOperation();
}

static void startupHeadPhase() {
  g_startupPhase = 1;
  g_startupPending = 1;
  for (int i = 0; i < 2; i++) {
    g_startupPending++;
    if (fsIOOpenRead(HEAD_PATH[i], FsIOOpenFlag_RDONLY, 0, HEAD_SIZE, onHeadRead, &g_slots[i]) == FS_IO_ERROR_FILE) g_startupPending--;
  }
  endStartupOperation();
}

extern "C" MSFS_CALLBACK void module_init(void) {
  fsCommBusRegister(EVENT_LOAD, onLoad, nullptr);
  fsCommBusRegister(EVENT_SAVE, onSave, nullptr);
  startupHeadPhase();
}

extern "C" MSFS_CALLBACK void module_deinit(void) {
  fsCommBusUnregisterAll();
}
