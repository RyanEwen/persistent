using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;

namespace Persistent.Desktop.Classes;

/// <summary>
/// Builds the tray HICON: the app mark, plus a count badge when reminders are due.
///
/// The badge is the whole point of the tray icon. A reminder app whose tray icon
/// looks identical whether nothing or nine things are overdue is decoration, and
/// this app has no notifications of its own (see docs/desktop-architecture.md) —
/// the icon is its only ambient signal.
/// </summary>
internal static class TrayIconRenderer
{
    /// <summary>Rendered at 32px: the shell downscales to the DPI-scaled tray slot,
    /// which stays crisp. Building at 16 forces an upscale on high-DPI displays.</summary>
    private const int Size = 32;

    private static readonly Color BadgeDue = Color.FromArgb(0xE5, 0x48, 0x4C);      // red - overdue
    private static readonly Color BadgeEscalated = Color.FromArgb(0xC1, 0x10, 0x1C); // deeper red - escalated
    private static readonly Color BadgeText = Color.White;

    /// <summary>
    /// Creates a new HICON. The caller owns it and must <c>DestroyIcon</c> it —
    /// the tray holds one at a time and leaks one per update otherwise.
    /// </summary>
    public static IntPtr Create(string basePath, int count, bool escalated)
    {
        using var canvas = new Bitmap(Size, Size);
        using (var g = Graphics.FromImage(canvas))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

            DrawBase(g, basePath);
            if (count > 0) DrawBadge(g, count, escalated);
        }

        // GetHicon hands back a fresh HICON; ownership transfers to the caller.
        return canvas.GetHicon();
    }

    private static void DrawBase(Graphics g, string basePath)
    {
        try
        {
            if (File.Exists(basePath))
            {
                using var icon = new Icon(basePath, Size, Size);
                g.DrawIcon(icon, new Rectangle(0, 0, Size, Size));
                return;
            }
        }
        catch
        {
            // Fall through to the placeholder below rather than showing nothing:
            // a missing icon file must not cost the user their only due-count signal.
        }

        using var brush = new SolidBrush(Color.FromArgb(0x6E, 0xA8, 0xFE));
        g.FillEllipse(brush, 3, 3, Size - 6, Size - 6);
    }

    private static void DrawBadge(Graphics g, int count, bool escalated)
    {
        // Two digits fit; beyond that the exact number stops mattering and "9+"
        // reads faster than a squeezed "12".
        string text = count > 9 ? "9+" : count.ToString();

        int diameter = text.Length > 1 ? 20 : 17;
        int x = Size - diameter;
        int y = Size - diameter;

        // A ring in the window background colour separates the badge from the mark
        // behind it at 16px, where the two would otherwise merge into one blob.
        using (var halo = new SolidBrush(ThemeManager.IsDarkTheme() ? Color.FromArgb(0x20, 0x20, 0x20) : Color.White))
        {
            g.FillEllipse(halo, x - 2, y - 2, diameter + 4, diameter + 4);
        }
        using (var fill = new SolidBrush(escalated ? BadgeEscalated : BadgeDue))
        {
            g.FillEllipse(fill, x, y, diameter, diameter);
        }

        float emSize = text.Length > 1 ? 9.5f : 11f;
        using var font = new Font("Segoe UI", emSize, FontStyle.Bold, GraphicsUnit.Pixel);
        using var textBrush = new SolidBrush(BadgeText);
        using var format = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center
        };
        g.DrawString(text, font, textBrush, new RectangleF(x, y, diameter, diameter), format);
    }
}
