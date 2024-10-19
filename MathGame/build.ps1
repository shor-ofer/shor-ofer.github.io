#bundle
Start-Process "cmd.exe" -ArgumentList "/c esbuild gamemanager.js --bundle --outfile=bundle.js"


# Parameters
$inputFile = "game.html"
$outputFile = "index.html"
$oldString = "gamemanager.js"
$newString = "bundle.js"

# Read the content of the input file
$content = Get-Content $inputFile

# Replace the old string with the new string
$newContent = $content -replace $oldString, $newString

# Write the updated content to the output file
$newContent | Set-Content $outputFile