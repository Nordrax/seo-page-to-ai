' Starts the SEO Page to AI bridge hub hidden (no console window). Used by the "SEO Page to AI bridge" logon task.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node """ & dir & "\server.mjs"" --hub", 0, False
