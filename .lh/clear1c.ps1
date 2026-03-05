Set-ExecutionPolicy Bypass
Get-childitem -Path $ENV:Userprofile\appdata\Roaming\1c\1cv8\* -Exclude *.pfl,def.usr -Recurse | Remove-item -recurse
Get-childitem -Path $ENV:Userprofile\appdata\Local\1c\1cv8\* -Exclude *.pfl -Recurse | Remove-item -Recurse
echo 'OK'
sleep 5