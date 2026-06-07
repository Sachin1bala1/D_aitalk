@echo off
"C:\Users\sachi\scoop\apps\llvm\current\bin\clang.exe" --target=x86_64-pc-windows-gnu -I"C:\msys64\mingw64\include" -femulated-tls %*
