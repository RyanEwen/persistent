using System.Runtime.InteropServices;

namespace Persistent.Widget;

/// <summary>Native COM registration and window messaging used only by the widget process.</summary>
internal static class NativeMethods
{
    public const uint ClsctxLocalServer = 0x4;
    public const uint RegclsMultipleUse = 0x1;

    [DllImport("ole32.dll")]
    public static extern int CoRegisterClassObject(
        [MarshalAs(UnmanagedType.LPStruct)] Guid clsid,
        [MarshalAs(UnmanagedType.IUnknown)] object classFactory,
        uint context,
        uint flags,
        out uint registration);

    [DllImport("ole32.dll")]
    public static extern int CoRevokeClassObject(uint registration);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindow(string? className, string? windowName);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint RegisterWindowMessage(string message);
}
