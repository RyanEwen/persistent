using Microsoft.UI.Input;
using Microsoft.UI.Xaml.Controls;

namespace Persistent.Desktop.Controls;

/// <summary>
/// A transparent strip along a window edge that shows a resize cursor.
///
/// This type exists for one reason: <c>UIElement.ProtectedCursor</c> is protected,
/// so the only way to give an element a cursor is from inside a derived class.
/// Everything else about dragging lives in <see cref="Windows.AppFlyout"/>, which
/// owns the window being resized.
///
/// A grip is invisible on purpose. The flyout has no frame to draw one in (that is
/// the whole point of the presenter it uses), and a visible handle inside a
/// 420px-wide column would sit on top of the hosted page.
/// </summary>
public partial class ResizeGrip : Panel
{
    /// <summary>Which way this edge stretches, read by the flyout's drag handler.</summary>
    public bool ResizesWidth { get; set; }
    public bool ResizesHeight { get; set; }

    public void SetCursor(InputSystemCursorShape shape) =>
        ProtectedCursor = InputSystemCursor.Create(shape);
}
