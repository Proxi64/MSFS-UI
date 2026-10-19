namespace MsfsUi.Core.Tests.Features;

/// <summary>A small catalogue in the format of <c>mod/features.json</c> (see Contracts in docs/development.md).</summary>
internal static class FeatureTestData
{
    public const string Catalog = """
        {
          "schemaVersion": 1,
          "modVersion": "1.0.0",
          "features": [
            {
              "id": "fastMenus",
              "title": "Fast menus",
              "description": "Shorter menu animations.",
              "screen": "All menus",
              "enabledByDefault": true,
              "options": [
                { "id": "speed", "type": "number", "title": "Speed", "description": "Animation speed factor.", "default": 2, "min": 1, "max": 4, "step": 0.5, "unit": "×" },
                { "id": "instantImages", "type": "boolean", "title": "Instant images", "description": "No image fade.", "default": true }
              ]
            },
            {
              "id": "tailNumber",
              "title": "Tail number per livery",
              "description": "Each livery keeps its registration.",
              "screen": "Everywhere",
              "enabledByDefault": false,
              "options": []
            }
          ]
        }
        """;
}
