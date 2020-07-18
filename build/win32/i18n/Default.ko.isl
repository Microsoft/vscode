; *** Inno Setup version 6.0.0+ Korean messages ***
;
; ▒ 6.0.3+ Translator: SungDong Kim (acroedit@gmail.com)
; ▒ 5.5.3+ Translator: Domddol (domddol@gmail.com)
; ▒ Translation date: MAR 04, 2014
; ▒ Contributors: Hansoo KIM (iryna7@gmail.com), Woong-Jae An (a183393@hanmail.net)
; ▒ Storage: http://www.jrsoftware.org/files/istrans/
; ▒ 이 번역은 새로운 한국어 맞춤법 규칙을 준수합니다.
; Note: When translating this text, do not add periods (.) to the end of
; messages that didn't have them already, because on those messages Inno
; Setup adds the periods automatically (appending a period would result in
; two periods being displayed).

[LangOptions]
; The following three entries are very important. Be sure to read and 
; understand the '[LangOptions] section' topic in the help file.
LanguageName=Korean
LanguageID=$0412
LanguageCodePage=949
; If the language you are translating to requires special font faces or
; sizes, uncomment any of the following entries and change them accordingly.
;DialogFontName=
;DialogFontSize=8
;WelcomeFontName=Verdana
;WelcomeFontSize=12
;TitleFontName=Arial
;TitleFontSize=29
;CopyrightFontName=Arial
;CopyrightFontSize=8

[Messages]

; *** Application titles
SetupAppTitle=설치
SetupWindowTitle=%1 설치
UninstallAppTitle=제거
UninstallAppFullTitle=%1 제거

; *** Misc. common
InformationTitle=정보
ConfirmTitle=확인
ErrorTitle=오류

; *** SetupLdr messages
SetupLdrStartupMessage=%1을(를) 설치합니다, 계속하시겠습니까?
LdrCannotCreateTemp=임시 파일을 만들 수 없습니다, 설치를 중단합니다
LdrCannotExecTemp=임시 폴더의 파일을 실행할 수 없습니다, 설치를 중단합니다
HelpTextNote=

; *** Startup error messages
LastErrorMessage=%1.%n%n오류 %2: %3
SetupFileMissing=%1 파일이 존재하지 않습니다, 문제를 해결해 보거나 새로운 설치 프로그램을 구하시기 바랍니다.
SetupFileCorrupt=설치 파일이 손상되었습니다, 새로운 설치 프로그램을 구하시기 바랍니다.
SetupFileCorruptOrWrongVer=설치 파일의 손상이거나 이 설치 버전과 호환되지 않습니다, 문제를 해결해 보거나 새로운 설치 프로그램을 구하시기 바랍니다.
InvalidParameter=잘못된 매개 변수입니다:%n%n%1
SetupAlreadyRunning=설치가 이미 실행 중입니다.
WindowsVersionNotSupported=이 프로그램은 귀하의 Windows 버전을 지원하지 않습니다.
WindowsServicePackRequired=이 프로그램을 실행하려면 %1 sp%2 이상이어야 합니다.
NotOnThisPlatform=이 프로그램은 %1에서 작동하지 않습니다.
OnlyOnThisPlatform=이 프로그램은 %1에서 실행해야 합니다.
OnlyOnTheseArchitectures=이 프로그램은 아래 처리 구조와 호환되는 Windows 버전에만 설치할 수 있습니다:%n%n%1
WinVersionTooLowError=이 프로그램은 %1 버전 %2 이상이 필요합니다.
WinVersionTooHighError=이 프로그램은 %1 버전 %2 이상에서 설치할 수 없습니다.
AdminPrivilegesRequired=이 프로그램을 설치하려면 관리자로 로그인해야 합니다.
PowerUserPrivilegesRequired=이 프로그램을 설치하려면 관리자 또는 고급 사용자로 로그인해야 합니다.
SetupAppRunningError=현재 %1이(가) 실행 중입니다!%n%n지금 그것의 모든 인스턴스를 닫아 주십시오. 그런 다음 계속하려면 "확인"을, 종료하려면 "취소"를 클릭하십시오.
UninstallAppRunningError=현재 %1이(가) 실행 중입니다!%n%n지금 그것의 모든 인스턴스를 닫아 주십시오. 그런 다음 계속하려면 "확인"을, 종료하려면 "취소"를 클릭하십시오.

; *** Startup questions
PrivilegesRequiredOverrideTitle=설치 모드 선택
PrivilegesRequiredOverrideInstruction=설치 모드를 선택해 주십시오
PrivilegesRequiredOverrideText1=%1 은 모든 사용자(관리자 권한 필요) 또는 현재 사용자용으로 설치합니다.
PrivilegesRequiredOverrideText2=%1 은 현재 사용자 또는 모든 사용자(관리자 권한 필요) 용으로 설치합니다.
PrivilegesRequiredOverrideAllUsers=모든 사용자용으로 설치(&A)
PrivilegesRequiredOverrideAllUsersRecommended=모든 사용자용으로 설치(&A) (추천)
PrivilegesRequiredOverrideCurrentUser=현재 사용자용으로 설치(&M)
PrivilegesRequiredOverrideCurrentUserRecommended=현재 사용자용으로 설치(&M) (추천)

; *** Misc. errors
ErrorCreatingDir="%1" 폴더를 만들 수 없습니다.
ErrorTooManyFilesInDir="%1" 폴더에 파일이 너무 많기 때문에 파일을 만들 수 없습니다.

; *** Setup common messages
ExitSetupTitle=설치 완료
ExitSetupMessage=설치가 완료되지 않았습니다, 여기서 설치를 종료하면 프로그램은 설치되지 않습니다.%n%n설치를 완료하려면 나중에 다시 설치 프로그램을 실행해야 합니다.%n%n그래도 설치를 종료하시겠습니까?
AboutSetupMenuItem=설치 정보(&A)...
AboutSetupTitle=설치 정보
AboutSetupMessage=%1 버전 %2%n%3%n%n%1 홈 페이지:%n%4
AboutSetupNote=
TranslatorNote=

; *** Buttons
ButtonBack=< 뒤로(&B)
ButtonNext=다음(&N) >
ButtonInstall=설치(&I)
ButtonOK=확인
ButtonCancel=취소
ButtonYes=예(&Y)
ButtonYesToAll=모두 예(&A)
ButtonNo=아니오(&N)
ButtonNoToAll=모두 아니오(&O)
ButtonFinish=종료(&F)
ButtonBrowse=찾아보기(&B)...
ButtonWizardBrowse=찾아보기(&R)...
ButtonNewFolder=새 폴더 만들기(&M)

; *** "Select Language" dialog messages
SelectLanguageTitle=설치 언어 선택
SelectLanguageLabel=설치에 사용할 언어를 선택하십시오.

; *** Common wizard text
ClickNext=계속하려면 "다음"을 클릭하고 설치를 종료하려면 "취소"를 클릭합니다.
BeveledLabel=
BrowseDialogTitle=폴더 찾아보기
BrowseDialogLabel=아래 목록에서 폴더를 선택한 다음 "확인"을 클릭합니다.
NewFolderName=새 폴더

; *** "Welcome" wizard page
WelcomeLabel1=[name] 설치 마법사 시작
WelcomeLabel2=이 마법사는 귀하의 컴퓨터에 [name/ver]을(를) 설치할 것입니다.%n%n설치하기 전에 다른 응용프로그램들을 모두 닫으시기 바랍니다.

; *** "Password" wizard page
WizardPassword=비밀 번호
PasswordLabel1=이 설치 마법사는 비밀 번호로 보호되어 있습니다.
PasswordLabel3=비밀 번호를 입력하고 "다음"을 클릭하십시오. 비밀 번호는 대소문자를 구분해야 합니다.
PasswordEditLabel=비밀 번호(&P):
IncorrectPassword=비밀 번호가 정확하지 않습니다, 다시 입력하십시오.

; *** "License Agreement" wizard page
WizardLicense=사용권 계약
LicenseLabel=계속하기 전에 다음의 중요 정보를 읽어보십시오.
LicenseLabel3=다음 사용권 계약을 읽어보십시오, 설치를 계속하려면 이 계약에 동의해야 합니다.
LicenseAccepted=동의합니다(&A)
LicenseNotAccepted=동의하지 않습니다(&D)

; *** "Information" wizard pages
WizardInfoBefore=정보
InfoBeforeLabel=계속하기 전에 다음의 중요 정보를 읽어보십시오.
InfoBeforeClickLabel=설치를 계속하려면 "다음"을 클릭하십시오.
WizardInfoAfter=정보
InfoAfterLabel=계속하기 전에 다음의 중요 정보를 읽어보십시오.
InfoAfterClickLabel=설치를 계속하려면 "다음"을 클릭하십시오.

; *** "User Information" wizard page
WizardUserInfo=사용자 정보
UserInfoDesc=사용자 정보를 입력하십시오.
UserInfoName=사용자 이름(&U):
UserInfoOrg=조직(&O):
UserInfoSerial=시리얼 번호(&S):
UserInfoNameRequired=사용자 이름을 입력하십시오.

; *** "Select Destination Location" wizard page
WizardSelectDir=설치 위치 선택
SelectDirDesc=[name]의 설치 위치를 선택하십시오.
SelectDirLabel3=다음 폴더에 [name]을(를) 설치합니다.
SelectDirBrowseLabel=계속하려면 "다음"을, 다른 폴더를 선택하려면 "찾아보기"를 클릭하십시오.
DiskSpaceGBLabel=이 프로그램은 최소 [gb] GB의 디스크 여유 공간이 필요합니다.
DiskSpaceMBLabel=이 프로그램은 최소 [mb] MB의 디스크 여유 공간이 필요합니다.
CannotInstallToNetworkDrive=네트워크 드라이브에 설치할 수 없습니다.
CannotInstallToUNCPath=UNC 경로에 설치할 수 없습니다.
InvalidPath=드라이브 문자를 포함한 전체 경로를 입력하십시오.%n※ 예: C:\APP %n%n또는, UNC 형식의 경로를 입력하십시오.%n※ 예: \\server\share
InvalidDrive=선택한 드라이브 또는 UNC 공유가 존재하지 않거나 액세스할 수 없습니다, 다른 경로를 선택하십시오.
DiskSpaceWarningTitle=디스크 공간이 부족합니다
DiskSpaceWarning=설치 시 최소 %1 KB 디스크 공간이 필요하지만, 선택한 드라이브의 여유 공간은 %2 KB 밖에 없습니다.%n%n그래도 계속하시겠습니까?
DirNameTooLong=폴더 이름 또는 경로가 너무 깁니다.
InvalidDirName=폴더 이름이 유효하지 않습니다.
BadDirName32=폴더 이름은 다음 문자를 포함할 수 없습니다:%n%n%1
DirExistsTitle=폴더가 존재합니다
DirExists=폴더 %n%n%1%n%n이(가) 이미 존재합니다, 이 폴더에 설치하시겠습니까?
DirDoesntExistTitle=폴더가 존재하지 않습니다
DirDoesntExist=폴더 %n%n%1%n%n이(가) 존재하지 않습니다, 새로 폴더를 만드시겠습니까?

; *** "Select Components" wizard page
WizardSelectComponents=구성 요소 선택
SelectComponentsDesc=설치할 구성 요소를 선택하십시오.
SelectComponentsLabel2=필요한 구성 요소는 체크하고 불필요한 구성 요소는 체크 해제합니다, 계속하려면 "다음"을 클릭하십시오.
FullInstallation=모두 설치
; if possible don't translate 'Compact' as 'Minimal' (I mean 'Minimal' in your language)
CompactInstallation=최소 설치
CustomInstallation=사용자 지정 설치
NoUninstallWarningTitle=구성 요소가 존재합니다
NoUninstallWarning=다음 구성 요소가 이미 설치되어 있습니다:%n%n%1%n%n위 구성 요소을 선택하지 않으면, 프로그램 제거시 이 구성 요소들은 제거되지 않을 겁니다.%n%n그래도 계속하시겠습니까?
ComponentSize1=%1 KB
ComponentSize2=%1 MB
ComponentsDiskSpaceGBLabel=현재 선택은 최소 [gb] GB의 디스크 여유 공간이 필요합니다.
ComponentsDiskSpaceMBLabel=현재 선택은 최소 [mb] MB의 디스크 여유 공간이 필요합니다.

; *** "Select Additional Tasks" wizard page
WizardSelectTasks=추가 작업 선택
SelectTasksDesc=수행할 추가 작업을 선택하십시오.
SelectTasksLabel2=[name] 설치 과정에 포함할 추가 작업을 선택한 후, "다음"을 클릭하십시오.

; *** "Select Start Menu Folder" wizard page
WizardSelectProgramGroup=시작 메뉴 폴더 선택
SelectStartMenuFolderDesc=어디에 프로그램 바로가기를 위치하겠습니까?
SelectStartMenuFolderLabel3=다음 시작 메뉴 폴더에 프로그램 바로가기를 만듭니다.
SelectStartMenuFolderBrowseLabel=계속하려면 "다음"을 클릭하고, 다른 폴더를 선택하려면 "찾아보기"를 클릭하십시오.
MustEnterGroupName=폴더 이름을 입력하십시오.
GroupNameTooLong=폴더 이름 또는 경로가 너무 깁니다.
InvalidGroupName=폴더 이름이 유효하지 않습니다.
BadGroupName=폴더 이름은 다음 문자를 포함할 수 없습니다:%n%n%1
NoProgramGroupCheck2=시작 메뉴 폴더를 만들지 않음(&D)

; *** "Ready to Install" wizard page
WizardReady=설치 준비 완료
ReadyLabel1=귀하의 컴퓨터에 [name]을(를) 설치할 준비가 되었습니다.
ReadyLabel2a=설치를 계속하려면 "설치"를, 설정을 변경하거나 검토하려면 "뒤로"를 클릭하십시오.
ReadyLabel2b=설치를 계속하려면 "설치"를 클릭하십시오.
ReadyMemoUserInfo=사용자 정보:
ReadyMemoDir=설치 위치:
ReadyMemoType=설치 유형:
ReadyMemoComponents=선택한 구성 요소:
ReadyMemoGroup=시작 메뉴 폴더:
ReadyMemoTasks=추가 작업:

; *** "Preparing to Install" wizard page
WizardPreparing=설치 준비 중
PreparingDesc=귀하의 컴퓨터에 [name] 설치를 준비하는 중입니다.
PreviousInstallNotCompleted=이전 프로그램의 설치/제거 작업이 완료되지 않았습니다, 완료하려면 컴퓨터를 다시 시작해야 합니다.%n%n컴퓨터를 다시 시작한 후, 설치 마법사를 다시 실행하여 [name] 설치를 완료하시기 바랍니다.
CannotContinue=설치를 계속할 수 없습니다, "취소"를 클릭하여 설치를 종료하십시오.
ApplicationsFound=다음 응용프로그램이 설치 업데이트가 필요한 파일을 사용하고 있습니다, 설치 마법사가 이런 응용프로그램을 자동으로 종료할 수 있도록 허용하시기 바랍니다.
ApplicationsFound2=다음 응용프로그램이 설치 업데이트가 필요한 파일을 사용하고 있습니다, 설치 마법사가 이런 응용프로그램을 자동으로 종료할 수 있도록 허용하시기 바랍니다. 설치가 완료되면, 설치 마법사는 이 응용프로그램이 다시 시작되도록 시도할 겁니다.
CloseApplications=자동으로 응용프로그램을 종료함(&A)
DontCloseApplications=응용프로그램을 종료하지 않음(&D)
ErrorCloseApplications=설치 마법사가 응용프로그램을 자동으로 종료할 수 없습니다, 계속하기 전에 설치 업데이트가 필요한 파일을 사용하고 있는 응용프로그램을 모두 종료하시기 바랍니다.
PrepareToInstallNeedsRestart=설치 마법사는 귀하의 컴퓨터를 재시작해야 합니다. [name] 설치를 완료하기 위해 컴퓨터를 다시 시작한 후에 설치 마법사를 다시 실행해 주십시오.%n%n지금 다시 시작하시겠습니까?

; *** "Installing" wizard page
WizardInstalling=설치 중
InstallingLabel=귀하의 컴퓨터에 [name]을(를) 설치하는 중... 잠시 기다려 주십시오.

; *** "Setup Completed" wizard page
FinishedHeadingLabel=[name] 설치 마법사 완료
FinishedLabelNoIcons=귀하의 컴퓨터에 [name]이(가) 설치되었습니다.
FinishedLabel=귀하의 컴퓨터에 [name]이(가) 설치되었습니다, 응용프로그램은 설치된 아이콘을 선택하여 시작할 수 있습니다.
ClickFinish=설치를 끝내려면 "종료"를 클릭하십시오.
FinishedRestartLabel=[name] 설치를 완료하려면, 컴퓨터를 다시 시작해야 합니다. 지금 다시 시작하시겠습니까?
FinishedRestartMessage=[name] 설치를 완료하려면, 컴퓨터를 다시 시작해야 합니다.%n%n지금 다시 시작하시겠습니까?
ShowReadmeCheck=예, README 파일을 표시합니다
YesRadio=예, 지금 다시 시작합니다(&Y)
NoRadio=아니오, 나중에 다시 시작합니다(&N)
; used for example as 'Run MyProg.exe'
RunEntryExec=%1 실행
; used for example as 'View Readme.txt'
RunEntryShellExec=%1 표시

; *** "Setup Needs the Next Disk" stuff
ChangeDiskTitle=디스크가 필요합니다
SelectDiskLabel2=디스크 %1을(를) 삽입하고 "확인"을 클릭하십시오.%n%n이 디스크 상의 파일이 아래 경로가 아닌 곳에 있는 경우, 올바른 경로를 입력하거나 "찾아보기"를 클릭하시기 바랍니다.
PathLabel=경로(&P):
FileNotInDir2=%2에 파일 %1을(를) 위치할 수 없습니다, 올바른 디스크를 삽입하거나 다른 폴더를 선택하십시오.
SelectDirectoryLabel=다음 디스크의 위치를 지정하십시오.

; *** Installation phase messages
SetupAborted=설치가 완료되지 않았습니다.%n%n문제를 해결한 후, 다시 설치를 시작하십시오.
AbortRetryIgnoreSelectAction=액션을 선택해 주십시오.
AbortRetryIgnoreRetry=재시도(&T)
AbortRetryIgnoreIgnore=오류를 무시하고 진행(&I)
AbortRetryIgnoreCancel=설치 취소

; *** Installation status messages
StatusClosingApplications=응용프로그램을 종료하는 중...
StatusCreateDirs=폴더를 만드는 중...
StatusExtractFiles=파일을 추출하는 중...
StatusCreateIcons=바로가기를 생성하는 중...
StatusCreateIniEntries=INI 항목을 만드는 중...
StatusCreateRegistryEntries=레지스트리 항목을 만드는 중...
StatusRegisterFiles=파일을 등록하는 중...
StatusSavingUninstall=제거 정보를 저장하는 중...
StatusRunProgram=설치를 완료하는 중...
StatusRestartingApplications=응용프로그램을 다시 시작하는 중...
StatusRollback=변경을 취소하는 중...

; *** Misc. errors
ErrorInternal2=내부 오류: %1
ErrorFunctionFailedNoCode=%1 실패
ErrorFunctionFailed=%1 실패; 코드 %2
ErrorFunctionFailedWithMessage=%1 실패, 코드: %2.%n%3
ErrorExecutingProgram=파일 실행 오류:%n%1

; *** Registry errors
ErrorRegOpenKey=레지스트리 키 열기 오류:%n%1\%2
ErrorRegCreateKey=레지스트리 키 생성 오류:%n%1\%2
ErrorRegWriteKey=레지스트리 키 쓰기 오류:%n%1\%2

; *** INI errors
ErrorIniEntry=%1 파일에 INI 항목 만들기 오류입니다.

; *** File copying errors
FileAbortRetryIgnoreSkipNotRecommended=이 파일을 건너띔(&S) (권장하지 않습니다)
FileAbortRetryIgnoreIgnoreNotRecommended=오류를 무시하고 진행(&I) (권장하지 않습니다)
SourceIsCorrupted=원본 파일이 손상됨
SourceDoesntExist=원본 파일 %1이(가) 존재하지 않음
ExistingFileReadOnly2=기존 파일은 읽기 전용이기때문에 대체할 수 없습니다.
ExistingFileReadOnlyRetry=읽기 전용 속성을 해제하고 다시 시도하려면(&R)
ExistingFileReadOnlyKeepExisting=기존 파일을 유지(&K)
ErrorReadingExistingDest=기존 파일을 읽는 동안 오류 발생:
FileExists=파일이 이미 존재합니다.%n%n파일을 덮어쓰시겠습니까?
ExistingFileNewer=기존 파일이 설치하려고 하는 파일보다 새 파일입니다, 기존 파일을 유지하시기 바랍니다.%n%n기존 파일을 유지하시겠습니까?
ErrorChangingAttr=기존 파일의 속성을 변경하는 동안 오류 발생:
ErrorCreatingTemp=대상 폴더에 파일을 만드는 동안 오류 발생:
ErrorReadingSource=원본 파일을 읽는 동안 오류 발생:
ErrorCopying=파일을 복사하는 동안 오류 발생:
ErrorReplacingExistingFile=기존 파일을 교체하는 동안 오류 발생:
ErrorRestartReplace=RestartReplace 실패:
ErrorRenamingTemp=대상 폴더 내의 파일 이름을 바꾸는 동안 오류 발생:
ErrorRegisterServer=DLL/OCX 등록 실패: %1
ErrorRegSvr32Failed=RegSvr32가 다음 종료 코드로 실패: %1
ErrorRegisterTypeLib=다음 유형의 라이브러리 등록에 실패: %1

; *** Uninstall display name markings
; used for example as 'My Program (32-bit)'
UninstallDisplayNameMark=%1 (%2)
; used for example as 'My Program (32-bit, All users)'
UninstallDisplayNameMarks=%1 (%2, %3)
UninstallDisplayNameMark32Bit=32비트
UninstallDisplayNameMark64Bit=64비트
UninstallDisplayNameMarkAllUsers=모든 사용자
UninstallDisplayNameMarkCurrentUser=현재 사용자

; *** Post-installation errors
ErrorOpeningReadme=README 파일을 여는 중 오류가 발생했습니다.
ErrorRestartingComputer=컴퓨터를 다시 시작할 수 없습니다, 수동으로 다시 시작하십시오.

; *** Uninstaller messages
UninstallNotFound=파일 %1이(가) 존재하지 않기 때문에, 제거를 실행할 수 없습니다.
UninstallOpenError=파일 %1을(를) 열 수 없기 때문에, 제거를 실행할 수 없습니다.
UninstallUnsupportedVer=삭제 로그 파일 "%1"은(는) 이 삭제 마법사로 인식할 수 없는 형식이기 때문에, 제거를 실행할 수 없습니다.
UninstallUnknownEntry=알 수 없는 항목 %1이(가) 삭제 로그에 포함되어 있습니다.
ConfirmUninstall=정말 %1와(과) 그 구성 요소를 모두 제거하시겠습니까?
UninstallOnlyOnWin64=이 프로그램은 64비트 Windows에서만 제거할 수 있습니다.
OnlyAdminCanUninstall=이 프로그램을 제거하려면 관리자 권한이 필요합니다.
UninstallStatusLabel=귀하의 컴퓨터에서 %1을(를) 제거하는 중... 잠시 기다려 주십시오.
UninstalledAll=%1이(가) 성공적으로 제거되었습니다!
UninstalledMost=%1 제거가 완료되었습니다.%n%n일부 요소는 삭제할 수 없으니, 수동으로 제거하시기 바랍니다.
UninstalledAndNeedsRestart=%1의 제거를 완료하려면, 컴퓨터를 다시 시작해야 합니다.%n%n지금 다시 시작하시겠습니까?
UninstallDataCorrupted=파일 "%1"이(가) 손상되었기 때문에, 제거를 실행할 수 없습니다.

; *** Uninstallation phase messages
ConfirmDeleteSharedFileTitle=공유 파일을 제거하시겠습니까?
ConfirmDeleteSharedFile2=시스템의 어떤 프로그램도 다음 공유 파일을 사용하지 않습니다, 이 공유 파일을 삭제하시겠습니까?%n%n이 파일을 다른 프로그램이 공유하고 있는 상태에서 이 파일을 제거할 경우, 해당 프로그램이 제대로 작동하지 않을 수 있으니, 확신이 없으면 "아니오"를 선택하셔도 됩니다. 시스템에 파일이 남아 있어도 문제가 되진 않습니다.
SharedFileNameLabel=파일 이름:
SharedFileLocationLabel=위치:
WizardUninstalling=제거 상태
StatusUninstalling=%1을(를) 제거하는 중...

; *** Shutdown block reasons
ShutdownBlockReasonInstallingApp=%1을(를) 설치하는 중입니다.
ShutdownBlockReasonUninstallingApp=%1을(를) 제거하는 중입니다.

; The custom messages below aren't used by Setup itself, but if you make
; use of them in your scripts, you'll want to translate them.

[CustomMessages]

NameAndVersion=%1 버전 %2
AdditionalIcons=아이콘 추가:
CreateDesktopIcon=바탕 화면에 바로가기 만들기(&D)
CreateQuickLaunchIcon=빠른 실행 아이콘 만들기(&Q)
ProgramOnTheWeb=%1 웹페이지
UninstallProgram=%1 제거
LaunchProgram=%1 실행
AssocFileExtension=파일 확장자 %2을(를) %1에 연결합니다.
AssocingFileExtension=파일 확장자 %2을(를) %1에 연결하는 중...
AutoStartProgramGroupDescription=시작:
AutoStartProgram=%1을(를) 자동으로 시작
AddonHostProgramNotFound=%1은(는) 선택한 폴더에 위치할 수 없습니다.%n%n그래도 계속하시겠습니까?
