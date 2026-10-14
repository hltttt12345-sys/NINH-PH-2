@echo off
set BIND=127.0.0.1
set COOKIE_SECURE=0
set SESSION_HOURS=12
set SCADA_SOURCE=NINH_PHU_2_JWF1520_14
if "%ADMIN_USERNAME%"=="" set ADMIN_USERNAME=admin
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=NinhPhu2@Local2026
if "%SESSION_SECRET%"=="" set SESSION_SECRET=local-session-secret-change-this
if "%SCADA_API_KEY%"=="" set SCADA_API_KEY=local-api-key-change-this
node server.js
pause
