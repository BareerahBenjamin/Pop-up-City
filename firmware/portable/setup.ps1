$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Get-Command py -ErrorAction SilentlyContinue) {
    $PythonCommand = 'py'
    $PythonArguments = @('-3')
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $PythonCommand = 'python'
    $PythonArguments = @()
} else {
    throw 'Install Python 3.9 or newer, then reopen PowerShell'
}
& $PythonCommand @PythonArguments -c 'import sys; sys.exit("Python 3.9 or newer is required" if sys.version_info < (3, 9) else 0)'
if ($LASTEXITCODE -ne 0) { throw 'A working Python 3.9 or newer is required' }
& $PythonCommand @PythonArguments -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Python venv creation failed' }
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& .\.venv\Scripts\python.exe flash.py --verify
if ($LASTEXITCODE -ne 0) { throw 'Firmware package validation failed' }
