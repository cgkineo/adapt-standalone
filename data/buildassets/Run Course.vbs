Dim WinScriptHost, strCurDir, strRun
Set WinScriptHost = CreateObject("WScript.Shell")
strCurDir    = WinScriptHost.CurrentDirectory
strRun =  strCurDir & "\data\node.exe " & strCurDir & "\data\server\server.js"
WinScriptHost.Run strRun, 0
Set WinScriptHost = Nothing