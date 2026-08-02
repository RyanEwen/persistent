using Microsoft.UI.Xaml;
using Persistent.Desktop.Classes;
using Persistent.Desktop.Classes.Settings;
using Persistent.Desktop.Services;
using Persistent.Desktop.Windows;
using System.Diagnostics;
using System.Runtime.InteropServices;
using WinRT.Interop;
using static Persistent.Desktop.Classes.NativeMethods;

namespace Persistent.Desktop;

/// <summary>
/// The invisible host window. Owns the tray icon and the app's lifetime; the
/// visible surfaces are the on-demand <see cref="AppFlyout"/> (which holds the
/// warm WebView2) and <see cref="SettingsWindow"/>.
/// </summary>
public sealed partial class MainWindow : Window
{
    private static readonly NLog.Logger Logger = NLog.LogManager.GetCurrentClassLogger();

    public const string HostWindowTitle = "Persistent Host";

    /// <summary>Posted by a second launch to ask the running instance to show the flyout.</summary>
    public static readonly uint WmShowFlyout = RegisterWindowMessage("Persistent_ShowFlyout");
    private static readonly uint WmTrayCallback = RegisterWindowMessage("Persistent_TrayCallback");

    /// <summary>Broadcast by the shell when Explorer (re)starts; we must re-add the tray icon.</summary>
    private static readonly uint WmTaskbarCreated = RegisterWindowMessage("TaskbarCreated");

    // Tray menu command ids.
    private const uint CmdOpen = 1, CmdBrowser = 2, CmdSettings = 3, CmdReload = 4, CmdExit = 5;
    private const uint TrayIconId = 1;

    private IntPtr _hwnd;
    private SUBCLASSPROC? _subclass;     // kept rooted
    private IntPtr _hIcon;
    private bool _trayAdded;
    private Microsoft.UI.Windowing.AppWindow? _appWindow;

    public MainWindow()
    {
        InitializeComponent();
        _hwnd = WindowNative.GetWindowHandle(this);

        // Make it a tool window (no taskbar button, no Alt+Tab) and keep it out of switchers.
        var ex = GetWindowLongPtr(_hwnd, GWL_EXSTYLE).ToInt64();
        SetWindowLongPtr(_hwnd, GWL_EXSTYLE, new IntPtr(ex | WS_EX_TOOLWINDOW));

        var wndId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd);
        _appWindow = Microsoft.UI.Windowing.AppWindow.GetFromWindowId(wndId);
        _appWindow.IsShownInSwitchers = false;
        HideHost();

        _subclass = WndProc;
        SetWindowSubclass(_hwnd, _subclass, IntPtr.Zero, IntPtr.Zero);
        Classes.StartupDiagnostics.Mark("Host window ready");

        AddTrayIcon();
        TrayState.Changed += OnTrayStateChanged;

        // Build the flyout (and start loading the PWA) now, not on first click: the
        // page's own WebSocket is what feeds the badge, so it has to be running
        // before the user ever opens anything.
        AppFlyout.EnsureCreated();
        Classes.StartupDiagnostics.Mark("Flyout created");

        // Windows 11 puts every new tray icon in the hidden overflow, so a
        // first launch otherwise looks like nothing happened at all. Show the
        // flyout once so the app proves it started and the user finds out where it
        // lives; after that it stays quiet and tray-only.
        if (!SettingsManager.Current.HasLaunchedBefore)
        {
            SettingsManager.Current.HasLaunchedBefore = true;
            SettingsManager.SaveSettings();
            Classes.StartupDiagnostics.Mark("First run - showing the flyout");
            App.MainDispatcherQueue.TryEnqueue(AppFlyout.Show);
        }
    }

    /// <summary>
    /// Keeps the host window off-screen/invisible. Called from the constructor and again
    /// after <c>Activate()</c> (which would otherwise re-show it). Uses AppWindow.Hide()
    /// rather than just SW_HIDE so WinUI's own show-on-activate is overridden.
    /// </summary>
    public void HideHost()
    {
        _appWindow?.Hide();
        ShowWindow(_hwnd, SW_HIDE);
    }

    // ── Tray icon ───────────────────────────────────────────────────
    private void AddTrayIcon()
    {
        var data = NewIconData();
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        data.uCallbackMessage = WmTrayCallback;
        data.hIcon = SwapIcon();
        data.szTip = Truncate(TrayState.Tooltip());
        _trayAdded = Shell_NotifyIcon(NIM_ADD, ref data);

        if (_trayAdded)
        {
            Classes.StartupDiagnostics.Mark("Tray icon added");
            return;
        }

        // The tray icon is this app's ONLY entry point. Without it the process
        // keeps running with no window, no icon and no way to reach it — which
        // looks exactly like "nothing happened when I launched it". Never let that
        // stand silently: say so, and open the flyout so the app is still usable.
        int err = Marshal.GetLastWin32Error();
        Logger.Warn("Shell_NotifyIcon(NIM_ADD) failed (Win32 {Error}) - falling back to the flyout", err);
        Classes.StartupDiagnostics.Warn(
            $"Persistent could not add its notification-area icon (Windows error {err}).\n\n" +
            "The app is running and its window will open now, but you won't have a tray icon this session.");
        App.MainDispatcherQueue.TryEnqueue(AppFlyout.Show);
    }

    /// <summary>Renders the current badge state and replaces the held HICON.</summary>
    private IntPtr SwapIcon()
    {
        IntPtr fresh = TrayIconRenderer.Create(App.IconPath, TrayState.ActiveCount, TrayState.HasEscalation);
        if (_hIcon != IntPtr.Zero) DestroyIcon(_hIcon);
        _hIcon = fresh;
        return _hIcon;
    }

    private void UpdateTrayIcon()
    {
        if (!_trayAdded) return;
        var data = NewIconData();
        data.uFlags = NIF_ICON | NIF_TIP;
        data.hIcon = SwapIcon();
        data.szTip = Truncate(TrayState.Tooltip());
        Shell_NotifyIcon(NIM_MODIFY, ref data);
    }

    private static string Truncate(string tip) => tip.Length > 127 ? tip[..127] : tip;

    private void RemoveTrayIcon()
    {
        if (!_trayAdded) return;
        var data = NewIconData();
        Shell_NotifyIcon(NIM_DELETE, ref data);
        _trayAdded = false;
        if (_hIcon != IntPtr.Zero) { DestroyIcon(_hIcon); _hIcon = IntPtr.Zero; }
    }

    private NOTIFYICONDATA NewIconData() => new()
    {
        cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATA>(),
        hWnd = _hwnd,
        uID = TrayIconId,
        szTip = string.Empty,
        szInfo = string.Empty,
        szInfoTitle = string.Empty
    };

    private void OnTrayStateChanged() => App.MainDispatcherQueue.TryEnqueue(UpdateTrayIcon);

    // ── Window procedure ────────────────────────────────────────────
    private IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, IntPtr id, IntPtr data)
    {
        if (msg == WmShowFlyout)
        {
            AppFlyout.Show();
            return IntPtr.Zero;
        }
        if (msg == WmTaskbarCreated)
        {
            // Explorer restarted — our tray icon was lost; re-add it.
            _trayAdded = false;
            AddTrayIcon();
            return IntPtr.Zero;
        }
        if (msg == WmTrayCallback)
        {
            int evt = (int)(lParam.ToInt64() & 0xFFFF); // classic model: lParam = mouse message
            switch (evt)
            {
                case WM_LBUTTONUP: AppFlyout.Toggle(); break;
                case WM_LBUTTONDBLCLK: AppFlyout.Show(); break;
                case WM_RBUTTONUP:
                case WM_CONTEXTMENU: ShowTrayMenu(); break;
            }
            return IntPtr.Zero;
        }
        return DefSubclassProc(hWnd, msg, wParam, lParam);
    }

    // ── Context menu ────────────────────────────────────────────────
    private void ShowTrayMenu()
    {
        IntPtr menu = CreatePopupMenu();

        // Status line (non-clickable) — the same summary as the tooltip, for the
        // case where the user went looking in the menu instead of hovering.
        AppendMenu(menu, MF_STRING | MF_GRAYED, 0, TrayState.Tooltip());
        AppendMenu(menu, MF_SEPARATOR, 0, null);

        AppendMenu(menu, MF_STRING, CmdOpen, "Open Persistent");
        AppendMenu(menu, MF_STRING, CmdBrowser, "Open in browser");
        AppendMenu(menu, MF_SEPARATOR, 0, null);
        AppendMenu(menu, MF_STRING, CmdReload, "Reload");
        AppendMenu(menu, MF_STRING, CmdSettings, "Settings");
        AppendMenu(menu, MF_SEPARATOR, 0, null);
        AppendMenu(menu, MF_STRING, CmdExit, "Exit");

        GetCursorPos(out var pt);
        SetForegroundWindow(_hwnd); // required so the menu dismisses on outside click
        uint cmd = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.X, pt.Y, 0, _hwnd, IntPtr.Zero);
        DestroyMenu(menu);

        switch (cmd)
        {
            case CmdOpen: AppFlyout.Show(); break;
            case CmdBrowser: OpenInBrowser(); break;
            case CmdReload: AppFlyout.Reload(); break;
            case CmdSettings: ShowSettings(); break;
            case CmdExit: ExitApp(); break;
        }
    }

    public static void OpenInBrowser()
    {
        string url = SettingsManager.Current.EffectiveServerUrl;
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Logger.Warn(ex, "Could not open {Url} in the default browser", url);
        }
    }

    public static void ShowSettings()
    {
        var w = SettingsWindow.GetCurrent() ?? new SettingsWindow();
        w.Activate();
        SetForegroundWindow(WindowNative.GetWindowHandle(w));
    }

    private void ExitApp()
    {
        TrayState.Changed -= OnTrayStateChanged;
        RemoveTrayIcon();
        if (_subclass != null) RemoveWindowSubclass(_hwnd, _subclass, IntPtr.Zero);
        AppFlyout.CloseForExit();
        Application.Current.Exit();
    }
}
