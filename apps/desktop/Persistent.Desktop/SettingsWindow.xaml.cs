using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.Pages;
using System.IO;
using System.Linq;
using WinRT.Interop;
using static Persistent.Desktop.Classes.NativeMethods;

namespace Persistent.Desktop;

/// <summary>
/// The on-demand settings window. Deliberately thin: it configures the *host*
/// (which server, theme, start-at-sign-in), not the product. Reminders, the
/// account, sounds and display preferences all live in the PWA, so anything that
/// belongs to a reminder belongs there, not here.
/// </summary>
public sealed partial class SettingsWindow : Window
{
    private static SettingsWindow? instance;
    private IntPtr _hIconSmall, _hIconBig;

    public SettingsWindow()
    {
        if (instance != null)
        {
            SetForegroundWindow(WindowNative.GetWindowHandle(instance));
            Close();
            return;
        }

        InitializeComponent();
        instance = this;

        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        var hwnd = WindowNative.GetWindowHandle(this);
        var wndId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(wndId);

        string iconPath = App.IconPath;
        if (File.Exists(iconPath))
        {
            ApplyWindowIcon(hwnd, iconPath);
            SetAppWindowIcon(appWindow, iconPath);
            LoadTitleBarIcon();
        }

        uint dpi = GetDpiForWindow(hwnd);
        double scale = dpi / 96.0;
        var settings = SettingsManager.Current;

        if (settings.SettingsWindowWidth > 0 && settings.SettingsWindowHeight > 0)
        {
            appWindow.Resize(new global::Windows.Graphics.SizeInt32(settings.SettingsWindowWidth, settings.SettingsWindowHeight));
            appWindow.Move(new global::Windows.Graphics.PointInt32(settings.SettingsWindowX, settings.SettingsWindowY));
        }
        else
        {
            int width = (int)(760 * scale), height = (int)(600 * scale);
            appWindow.Resize(new global::Windows.Graphics.SizeInt32(width, height));
            GetCursorPos(out var cursorPt);
            var monitor = MonitorFromPoint(cursorPt, MONITOR_DEFAULTTONEAREST);
            var mi = new MONITORINFOEX { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfo(monitor, ref mi))
            {
                int cx = mi.rcWork.Left + (mi.rcWork.Right - mi.rcWork.Left - width) / 2;
                int cy = mi.rcWork.Top + (mi.rcWork.Bottom - mi.rcWork.Top - height) / 2;
                appWindow.Move(new global::Windows.Graphics.PointInt32(cx, cy));
            }
        }

        RootNavigation.SelectedItem = RootNavigation.MenuItems[0];
        ContentFrame.Navigate(typeof(ConnectionPage));
        Classes.ThemeManager.ApplySavedTheme(this);

        Activated += (s, e) =>
        {
            if (_hIconBig != IntPtr.Zero)
            {
                var h = WindowNative.GetWindowHandle(this);
                SendMessage(h, WM_SETICON, new IntPtr(ICON_SMALL), _hIconSmall);
                SendMessage(h, WM_SETICON, new IntPtr(ICON_BIG), _hIconBig);
            }
        };

        Closed += SettingsWindow_Closed;
    }

    public static SettingsWindow? GetCurrent() => instance;

    private void RootNavigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        Type? pageType = args.IsSettingsSelected
            ? typeof(AppSettingsPage)
            : (args.SelectedItem as NavigationViewItem)?.Tag is string tag ? GetPageTypeFromTag(tag) : null;
        if (pageType == null || ContentFrame.Content?.GetType() == pageType) return;
        ContentFrame.Navigate(pageType);
    }

    private static Type? GetPageTypeFromTag(string tag) => tag switch
    {
        "ConnectionPage" => typeof(ConnectionPage),
        "AboutPage" => typeof(AboutPage),
        _ => null
    };

    private static void SetAppWindowIcon(AppWindow appWindow, string icoPath)
    {
        var hIcon = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 64, 64, LR_LOADFROMFILE);
        if (hIcon == IntPtr.Zero) return;
        try { appWindow.SetIcon(Microsoft.UI.Win32Interop.GetIconIdFromIcon(hIcon)); }
        finally { DestroyIcon(hIcon); }
    }

    private void ApplyWindowIcon(IntPtr hwnd, string icoPath)
    {
        if (_hIconSmall != IntPtr.Zero) { DestroyIcon(_hIconSmall); _hIconSmall = IntPtr.Zero; }
        if (_hIconBig != IntPtr.Zero) { DestroyIcon(_hIconBig); _hIconBig = IntPtr.Zero; }
        // Load generous sizes so the shell downscales (crisp) at any DPI rather than
        // upscaling a 16/32 frame: small is drawn at 16*scale, big at 32*scale.
        _hIconSmall = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);
        _hIconBig = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 64, 64, LR_LOADFROMFILE);
        if (_hIconSmall != IntPtr.Zero) SendMessage(hwnd, WM_SETICON, new IntPtr(ICON_SMALL), _hIconSmall);
        if (_hIconBig != IntPtr.Zero) SendMessage(hwnd, WM_SETICON, new IntPtr(ICON_BIG), _hIconBig);
    }

    private void LoadTitleBarIcon()
    {
        // Use the high-res PNG (not the .ico) so it scales down crisply to 16px.
        try { TitleBarIcon.Source = new BitmapImage(new Uri(App.IconImagePath)); }
        catch { /* leave empty */ }
    }

    private void SettingsWindow_Closed(object sender, WindowEventArgs e)
    {
        var hwnd = WindowNative.GetWindowHandle(this);
        var wndId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(wndId);
        var settings = SettingsManager.Current;

        bool isMaximized = appWindow.Presenter is OverlappedPresenter p && p.State == OverlappedPresenterState.Maximized;
        if (!isMaximized)
        {
            settings.SettingsWindowX = appWindow.Position.X;
            settings.SettingsWindowY = appWindow.Position.Y;
            settings.SettingsWindowWidth = appWindow.Size.Width;
            settings.SettingsWindowHeight = appWindow.Size.Height;
        }
        SettingsManager.SaveSettings();

        if (_hIconSmall != IntPtr.Zero) { DestroyIcon(_hIconSmall); _hIconSmall = IntPtr.Zero; }
        if (_hIconBig != IntPtr.Zero) { DestroyIcon(_hIconBig); _hIconBig = IntPtr.Zero; }
        instance = null;
    }
}
