Dim WinScriptHost, strCurDir, strRun
Set WinScriptHost = CreateObject("WScript.Shell")
strCurDir = WinScriptHost.CurrentDirectory
strRun = chr(34) & strCurDir & "\data\node.exe" & chr(34) & " " & chr(34) & strCurDir & "\data\server\server.js" & chr(34)
WinScriptHost.Run strRun, 0
Set WinScriptHost = Nothing