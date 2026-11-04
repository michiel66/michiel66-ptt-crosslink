param(
  [Parameter(Mandatory=$true)][string]$Message,
  [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$sp = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  # Prefer a Dutch voice when the system has one installed.
  $dutch = $sp.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'nl-*' } | Select-Object -First 1
  if ($null -ne $dutch) { $sp.SelectVoice($dutch.VoiceInfo.Name) }
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $sp.SetOutputToWaveFile($OutputFile, $format)
  $sp.Speak($Message)
  $sp.SetOutputToNull()
} finally {
  $sp.Dispose()
}
