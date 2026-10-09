using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Globalization;
using System.Text.Json;

namespace Persistent.Desktop.Classes;

/// <summary>Apply the hosted app's resolved colors to its native frame without owning a second theme preference.</summary>
internal static class FlyoutAppearance
{
    /// <summary>Validate a bounded display-only message before applying it on the window's dispatcher.</summary>
    public static bool TryRead(JsonElement message, out bool dark, out global::Windows.UI.Color background)
    {
        dark = false;
        background = default;
        if (!message.TryGetProperty("mode", out var mode) || mode.ValueKind != JsonValueKind.String) return false;
        string? selected = mode.GetString();
        if (selected != "light" && selected != "dark") return false;
        if (!message.TryGetProperty("background", out var color) || color.ValueKind != JsonValueKind.String) return false;
        string? hex = color.GetString();
        if (hex == null || hex.Length != 7 || hex[0] != '#') return false;
        if (!uint.TryParse(hex.AsSpan(1), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out uint rgb)) return false;
        dark = selected == "dark";
        background = global::Windows.UI.Color.FromArgb(255, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
        return true;
    }

    /// <summary>Keep WinUI glyphs, the WebView loading background, and DWM corners consistent with page content.</summary>
    public static void Apply(Grid root, WebView2 webView, IntPtr hwnd, bool dark, global::Windows.UI.Color background)
    {
        root.RequestedTheme = dark ? ElementTheme.Dark : ElementTheme.Light;
        root.Background = new SolidColorBrush(background);
        webView.DefaultBackgroundColor = background;
        int immersiveDark = dark ? 1 : 0;
        NativeMethods.DwmSetWindowAttribute(hwnd, NativeMethods.DWMWA_USE_IMMERSIVE_DARK_MODE, ref immersiveDark, sizeof(int));
    }
}
