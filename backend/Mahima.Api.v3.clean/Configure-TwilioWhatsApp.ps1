<#
.SYNOPSIS
  Configures Twilio WhatsApp environment variables without storing secrets in source control.
#>

param(
  [Parameter(Mandatory = $true)] [string]$AccountSid,
  [Parameter(Mandatory = $true)] [SecureString]$AuthToken,
  [Parameter(Mandatory = $true)] [string]$WhatsAppFrom,
  [string]$MessagingServiceSid = "",
  [ValidateSet("Process", "User", "Machine")] [string]$Scope = "User"
)

if ($WhatsAppFrom -notmatch '^whatsapp:\+[1-9][0-9]{7,14}$') {
  throw "WhatsAppFrom must use the format whatsapp:+E164, for example whatsapp:+919876543210."
}

$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AuthToken)
try {
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  $values = [ordered]@{
    TWILIO_ACCOUNT_SID = $AccountSid
    TWILIO_AUTH_TOKEN = $plainToken
    TWILIO_WHATSAPP_FROM = $WhatsAppFrom
    TWILIO_WABA_ID = "1524302335677666"
    TWILIO_META_BUSINESS_MANAGER_ID = "1671724153931621"
  }
  if ($MessagingServiceSid) { $values.TWILIO_MESSAGING_SERVICE_SID = $MessagingServiceSid }

  $target = switch ($Scope) {
    "Process" { [EnvironmentVariableTarget]::Process }
    "Machine" { [EnvironmentVariableTarget]::Machine }
    default { [EnvironmentVariableTarget]::User }
  }

  foreach ($entry in $values.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, $target)
  }
  Write-Host "Twilio WhatsApp configuration saved for scope '$Scope'. Restart the Mahima API process to load it."
}
finally {
  if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
  $plainToken = $null
}
