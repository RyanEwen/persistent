using Microsoft.Windows.Widgets.Providers;
using NLog;
using NLog.Config;
using NLog.Targets;
using System.Runtime.InteropServices;
using WinRT;
using static Persistent.Widget.NativeMethods;

namespace Persistent.Widget;

/// <summary>
/// COM-server entry point started by the Windows Widgets host. The provider is a
/// separate packaged process so opening or closing the tray app cannot tear down
/// a widget that Windows is currently rendering.
/// </summary>
internal static class Program
{
    private const string ComActivationArgument = "-RegisterProcessAsComServer";

    [MTAThread]
    private static void Main(string[] args)
    {
        ConfigureLogging();
        var logger = LogManager.GetCurrentClassLogger();

        if (args.Length == 0 || args[0] != ComActivationArgument)
        {
            logger.Warn("Widget provider started without the COM activation argument; exiting");
            return;
        }

        try
        {
            ComWrappersSupport.InitializeComWrappers();
            using var registration = WidgetProviderRegistration.Register<PersistentWidgetProvider>();
            logger.Info("Widget provider registered");

            // Stay available while at least one widget is pinned, then release
            // the COM class object after Windows deletes the last instance.
            PersistentWidgetProvider.EmptyWidgetListEvent.WaitOne();
        }
        catch (Exception ex)
        {
            logger.Error(ex, "Widget provider failed");
        }
        finally
        {
            LogManager.Shutdown();
        }
    }

    /// <summary>
    /// Configure the same per-user log folder as the desktop host without relying
    /// on a current working directory chosen by the Widgets broker.
    /// </summary>
    private static void ConfigureLogging()
    {
        string logDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Persistent");
        Directory.CreateDirectory(logDirectory);

        var configuration = new LoggingConfiguration();
        var file = new FileTarget("widgetFile")
        {
            FileName = Path.Combine(logDirectory, "widget.log"),
            Layout = "${longdate}|${level:uppercase=true}|${message} ${exception:format=tostring}"
        };
        configuration.AddRule(LogLevel.Info, LogLevel.Fatal, file);
        LogManager.Configuration = configuration;
    }
}

/// <summary>
/// Registers a managed widget provider as an out-of-process COM class.
/// </summary>
internal static class WidgetProviderRegistration
{
    public static IDisposable Register<T>() where T : IWidgetProvider, new()
    {
        var factory = new WidgetProviderFactory<T>();
        int result = CoRegisterClassObject(
            typeof(T).GUID,
            factory,
            ClsctxLocalServer,
            RegclsMultipleUse,
            out uint cookie);
        Marshal.ThrowExceptionForHR(result);
        return new Registration(cookie, factory);
    }

    private sealed class Registration(uint cookie, object rootedFactory) : IDisposable
    {
        private readonly object _rootedFactory = rootedFactory;

        public void Dispose()
        {
            GC.KeepAlive(_rootedFactory);
            CoRevokeClassObject(cookie);
        }
    }

}

/// <summary>
/// Creates the WinRT projection that the widget broker expects from COM.
/// </summary>
internal sealed class WidgetProviderFactory<T> : IClassFactory
    where T : IWidgetProvider, new()
{
    public int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr instance)
    {
        instance = IntPtr.Zero;
        if (outer != IntPtr.Zero) return ClassENoAggregation;
        if (interfaceId != typeof(T).GUID && interfaceId != IUnknownId) return ENoInterface;

        instance = MarshalInspectable<IWidgetProvider>.FromManaged(new T());
        return 0;
    }

    public int LockServer([MarshalAs(UnmanagedType.Bool)] bool shouldLock) => 0;

    private static readonly Guid IUnknownId = new("00000000-0000-0000-C000-000000000046");
    private const int ClassENoAggregation = unchecked((int)0x80040110);
    private const int ENoInterface = unchecked((int)0x80004002);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("00000001-0000-0000-C000-000000000046")]
internal interface IClassFactory
{
    [PreserveSig]
    int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr instance);

    [PreserveSig]
    int LockServer([MarshalAs(UnmanagedType.Bool)] bool shouldLock);
}
