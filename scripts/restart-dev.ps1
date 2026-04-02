# Kill the TaskDock app and any processes holding the dev ports, then start dev
Stop-Process -Name taskdock -Force -ErrorAction SilentlyContinue

foreach ($port in 5198, 5199) {
    $pids = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    foreach ($id in $pids) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 500
