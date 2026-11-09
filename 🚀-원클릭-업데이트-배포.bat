@echo off
chcp 65001 > nul
title 신세계 CAD 뷰어 - 원클릭 업데이트 배포기
echo ======================================================================
echo   신세계푸드 모바일 정밀 CAD 뷰어 (실시간 무설치 배포)
echo ======================================================================
echo.
echo [1/2] 웹 앱 빌드 중... (npm run build)
call npm run build
if %errorlevel% neq 0 (
    echo [오류] 빌드 실패! 코드를 확인하세요.
    pause
    exit /b %errorlevel%
)
echo.
echo [2/2] Firebase 라이브 클라우드 배포 중...
call npx firebase-tools deploy --only hosting
if %errorlevel% neq 0 (
    echo [오류] 배포 실패! 인터넷 연결이나 권한을 확인하세요.
    pause
    exit /b %errorlevel%
)
echo.
echo ======================================================================
echo   🎉 배포 완료!
echo.
echo   스마트폰/태블릿에 앱을 설치한 사람들은
echo   앱을 열 때 1초 만에 최신 도면과 화면으로 100%% 자동 갱신됩니다!
echo   (APK를 다시 배포하거나 재설치할 필요가 없습니다)
echo ======================================================================
echo.
pause
