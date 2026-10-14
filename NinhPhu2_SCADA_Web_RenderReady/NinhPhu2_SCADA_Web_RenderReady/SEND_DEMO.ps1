param(
  [string]$Url = "http://localhost:3000/api/ingest",
  [string]$ApiKey = "local-api-key-change-this"
)
$now = Get-Date
$start = Get-Date -Hour 6 -Minute 0 -Second 0
if($now.Hour -ge 18){ $start = Get-Date -Hour 18 -Minute 0 -Second 0; $shift='B' } elseif($now.Hour -lt 6){ $start=(Get-Date -Hour 18 -Minute 0 -Second 0).AddDays(-1); $shift='B' } else { $shift='A' }
$machines = 9..22 | ForEach-Object {
  [ordered]@{number=$_;connected=$true;runState=($_ % 3 -ne 0);realtimeCode=if($_ % 3 -ne 0){'RUNNING'}else{'STOP_TROUBLE'};status=if($_ % 3 -ne 0){'MÁY ĐANG CHẠY'}else{'MÁY DỪNG / SỰ CỐ'};currentM=(1000+$_*123);aCurrentM=(1000+$_*123);bCurrentM=0;totalM=(100000+$_*1000);spindle=if($_ % 3 -ne 0){14500}else{0};roller=if($_ % 3 -ne 0){800}else{0};frequencyHz=if($_ % 3 -ne 0){48.5}else{0};currentLengthM=1200;fullBobbinM=3000;runtimeSeconds=12000;stoptimeSeconds=500;lastAt=$now.ToString('o')}
}
$body=[ordered]@{source='NINH_PHU_2_JWF1520_14';sentAt=$now.ToString('o');reading=$true;shift=[ordered]@{key=$start.ToString('yyyyMMddHHmm')+'-'+$shift;name='Ca '+$shift;start=$start.ToString('o');end=$start.AddHours(12).ToString('o')};machines=$machines;history=@()}
Invoke-RestMethod -Method Post -Uri $Url -Headers @{'X-API-Key'=$ApiKey} -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 8)
