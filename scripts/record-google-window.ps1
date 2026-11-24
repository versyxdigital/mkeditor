param(
  [ValidateSet('list', 'info', 'focus', 'capture')][string]$Mode = 'list',
  [long]$WindowHandle = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class GoogleReviewWindows {
  public delegate bool Callback(IntPtr window, IntPtr arg);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr arg);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int action);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint first, uint second, bool attach);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr device, uint flags);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  public static long[] List() {
    var result = new List<long>();
    EnumWindows((window,arg) => {
      var name = new StringBuilder(256); GetClassName(window,name,256);
      if(name.ToString() != "Chrome_WidgetWin_1" || !IsWindowVisible(window)) return true;
      uint process; GetWindowThreadProcessId(window,out process);
      try { if(System.Diagnostics.Process.GetProcessById((int)process).ProcessName == "chrome") result.Add(window.ToInt64()); } catch {}
      return true;
    },IntPtr.Zero);
    return result.ToArray();
  }
}
'@
if ($Mode -eq 'list') {
  ConvertTo-Json -InputObject @([GoogleReviewWindows]::List()) -Compress
  exit
}
$recordingHandle = [IntPtr]$WindowHandle
if ($Mode -eq 'focus') {
  [GoogleReviewWindows]::ShowWindowAsync($recordingHandle, 9) | Out-Null
  [GoogleReviewWindows]::ShowWindowAsync($recordingHandle, 5) | Out-Null
  [GoogleReviewWindows]::MoveWindow($recordingHandle, 60, 40, 1320, 950, $true) | Out-Null
  $foregroundProcess = [uint32]0
  $foregroundThread = [GoogleReviewWindows]::GetWindowThreadProcessId([GoogleReviewWindows]::GetForegroundWindow(), [ref]$foregroundProcess)
  $currentThread = [GoogleReviewWindows]::GetCurrentThreadId()
  [GoogleReviewWindows]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null
  try { [GoogleReviewWindows]::SetForegroundWindow($recordingHandle) | Out-Null }
  finally { [GoogleReviewWindows]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null }
  '{"focused":true}'
  exit
}
$recordingRoot = [System.Windows.Automation.AutomationElement]::FromHandle($recordingHandle)
$documentCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$recordingDocument = $recordingRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $documentCondition)
if ($null -eq $recordingDocument) { '{"ready":false}'; exit }
$documentBounds = $recordingDocument.Current.BoundingRectangle
$clientOrigin = [GoogleReviewWindows+Point]::new()
[GoogleReviewWindows]::ClientToScreen($recordingHandle, [ref]$clientOrigin) | Out-Null
$editCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$recordingEdits = $recordingDocument.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
$visibleEdits = 0
foreach ($recordingEdit in $recordingEdits) { if (-not $recordingEdit.Current.IsOffscreen) { $visibleEdits++ } }
if ($Mode -eq 'capture') {
  if ($visibleEdits -gt 0) { '{"ready":true,"sensitive":true}'; exit }
  $windowBounds = [GoogleReviewWindows+Rect]::new()
  [GoogleReviewWindows]::GetWindowRect($recordingHandle, [ref]$windowBounds) | Out-Null
  $recordingBitmap = [System.Drawing.Bitmap]::new($windowBounds.Right - $windowBounds.Left, $windowBounds.Bottom - $windowBounds.Top)
  $recordingGraphics = [System.Drawing.Graphics]::FromImage($recordingBitmap)
  $recordingStream = [System.IO.MemoryStream]::new()
  try {
    $recordingDevice = $recordingGraphics.GetHdc()
    try { $printed = [GoogleReviewWindows]::PrintWindow($recordingHandle, $recordingDevice, 2) }
    finally { $recordingGraphics.ReleaseHdc($recordingDevice) }
    if (-not $printed) { '{"ready":false}'; exit }
    $contentRectangle = [System.Drawing.Rectangle]::new([int]($documentBounds.X - $windowBounds.Left), [int]($documentBounds.Y - $windowBounds.Top), [int]$documentBounds.Width, [int]$documentBounds.Height)
    $contentBitmap = $recordingBitmap.Clone($contentRectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $contentBitmap.Save($recordingStream, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $contentBitmap.Dispose() }
    [pscustomobject]@{ ready = $true; sensitive = $false; png = [Convert]::ToBase64String($recordingStream.ToArray()) } | ConvertTo-Json -Compress
  } finally { $recordingStream.Dispose(); $recordingGraphics.Dispose(); $recordingBitmap.Dispose() }
  exit
}
[pscustomobject]@{
  ready = $true
  visible = [GoogleReviewWindows]::IsWindowVisible($recordingHandle)
  foreground = [GoogleReviewWindows]::GetForegroundWindow() -eq $recordingHandle
  editFields = $visibleEdits
  x = [Math]::Max(0, [int]($documentBounds.X - $clientOrigin.X))
  y = [Math]::Max(0, [int]($documentBounds.Y - $clientOrigin.Y))
  width = [int]$documentBounds.Width
  height = [int]$documentBounds.Height
} | ConvertTo-Json -Compress
