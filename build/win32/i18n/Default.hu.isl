;Inno Setup version 6.0.3+ Hungarian messages
;Based on the translation of Kornél Pál, kornelpal@gmail.com
;István Szabó, E-mail: istvanszabo890629@gmail.com
;
; To download user-contributed translations of this file, go to:
;   http://www.jrsoftware.org/files/istrans/
;
; Note: When translating this text, do not add periods (.) to the end of
; messages that didn't have them already, because on those messages Inno
; Setup adds the periods automatically (appending a period would result in
; two periods being displayed).

[LangOptions]
; The following three entries are very important. Be sure to read and 
; understand the '[LangOptions] section' topic in the help file.
LanguageName=Magyar
LanguageID=$040E
LanguageCodePage=1250
; If the language you are translating to requires special font faces or
; sizes, uncomment any of the following entries and change them accordingly.
;DialogFontName=
;DialogFontSize=8
;WelcomeFontName=Verdana
;WelcomeFontSize=12
;TitleFontName=Arial CE
;TitleFontSize=29
;CopyrightFontName=Arial CE
;CopyrightFontSize=8

[Messages]

; *** Application titles
SetupAppTitle=Telepítõ
SetupWindowTitle=%1 - Telepítõ
UninstallAppTitle=Eltávolító
UninstallAppFullTitle=%1 Eltávolító

; *** Misc. common
InformationTitle=Információk
ConfirmTitle=Megerõsít
ErrorTitle=Hiba

; *** SetupLdr messages
SetupLdrStartupMessage=%1 telepítve lesz. Szeretné folytatni?
LdrCannotCreateTemp=Átmeneti fájl létrehozása nem lehetséges. A telepítés megszakítva
LdrCannotExecTemp=Fájl futtatása nem lehetséges az átmeneti könyvtárban. A telepítés megszakítva
HelpTextNote=

; *** Startup error messages
LastErrorMessage=%1.%n%nHiba %2: %3
SetupFileMissing=A(z) %1 fájl hiányzik a telepítõ könyvtárából. Kérem hárítsa el a problémát, vagy szerezzen be egy másik példányt a programból!
SetupFileCorrupt=A telepítési fájlok sérültek. Kérem, szerezzen be új másolatot a programból!
SetupFileCorruptOrWrongVer=A telepítési fájlok sérültek, vagy inkompatibilisek a telepítõ ezen verziójával. Hárítsa el a problémát, vagy szerezzen be egy másik példányt a programból!
InvalidParameter=A parancssorba átadott paraméter érvénytelen:%n%n%1
SetupAlreadyRunning=A Telepítõ már fut.
WindowsVersionNotSupported=A program nem támogatja a Windows ezen verzióját.
WindowsServicePackRequired=A program futtatásához %1 Service Pack %2 vagy újabb szükséges.
NotOnThisPlatform=Ez a program nem futtatható %1 alatt.
OnlyOnThisPlatform=Ezt a programot %1 alatt kell futtatni.
OnlyOnTheseArchitectures=A program kizárólag a következõ processzor architektúrákhoz tervezett Windows-on telepíthetõ:%n%n%1
WinVersionTooLowError=A program futtatásához %1 %2 verziója vagy késõbbi szükséges.
WinVersionTooHighError=Ez a program nem telepíthetõ %1 %2 vagy késõbbire.
AdminPrivilegesRequired=Csak rendszergazdai módban telepíthetõ ez a program.
PowerUserPrivilegesRequired=Csak rendszergazdaként vagy kiemelt felhasználóként telepíthetõ ez a program.
SetupAppRunningError=A telepítõ úgy észlelte %1 jelenleg fut.%n%nZárja be az összes példányt, majd kattintson az 'OK'-ra a folytatáshoz, vagy a 'Mégse'-re a kilépéshez.
UninstallAppRunningError=Az eltávolító úgy észlelte %1 jelenleg fut.%n%nZárja be az összes példányt, majd kattintson az 'OK'-ra a folytatáshoz, vagy a 'Mégse'-re a kilépéshez.

; *** Startup questions
PrivilegesRequiredOverrideTitle=Telepítési mód kiválasztása
PrivilegesRequiredOverrideInstruction=Válasszon telepítési módot
PrivilegesRequiredOverrideText1=%1 telepíthetõ az összes felhasználónak (rendszergazdai jogok szükségesek), vagy csak magának.
PrivilegesRequiredOverrideText2=%1 csak magának telepíthetõ, vagy az összes felhasználónak (rendszergazdai jogok szükségesek).
PrivilegesRequiredOverrideAllUsers=Telepítés &mindenkinek
PrivilegesRequiredOverrideAllUsersRecommended=Telepítés &mindenkinek (ajánlott)
PrivilegesRequiredOverrideCurrentUser=Telepítés csak &nekem
PrivilegesRequiredOverrideCurrentUserRecommended=Telepítés csak &nekem (ajánlott)

; *** Misc. errors
ErrorCreatingDir=A Telepítõ nem tudta létrehozni a(z) "%1" könyvtárat
ErrorTooManyFilesInDir=Nem hozható létre fájl a(z) "%1" könyvtárban, mert az már túl sok fájlt tartalmaz

; *** Setup common messages
ExitSetupTitle=Kilépés a telepítõbõl
ExitSetupMessage=A telepítés még folyamatban van. Ha most kilép, a program nem kerül telepítésre.%n%nMásik alkalommal is futtatható a telepítés befejezéséhez%n%nKilép a telepítõbõl?
AboutSetupMenuItem=&Névjegy...
AboutSetupTitle=Telepítõ névjegye
AboutSetupMessage=%1 %2 verzió%n%3%n%nAz %1 honlapja:%n%4
AboutSetupNote=
TranslatorNote=

; *** Buttons
ButtonBack=< &Vissza
ButtonNext=&Tovább >
ButtonInstall=&Telepít
ButtonOK=OK
ButtonCancel=Mégse
ButtonYes=&Igen
ButtonYesToAll=&Mindet
ButtonNo=&Nem
ButtonNoToAll=&Egyiket se
ButtonFinish=&Befejezés
ButtonBrowse=&Tallózás...
ButtonWizardBrowse=T&allózás...
ButtonNewFolder=Új &könyvtár

; *** "Select Language" dialog messages
SelectLanguageTitle=Telepítõ nyelvi beállítás
SelectLanguageLabel=Válassza ki a telepítés alatt használt nyelvet.

; *** Common wizard text
ClickNext=A folytatáshoz kattintson a 'Tovább'-ra, a kilépéshez a 'Mégse'-re.
BeveledLabel=
BrowseDialogTitle=Válasszon könyvtárt 
BrowseDialogLabel=Válasszon egy könyvtárat az alábbi listából, majd kattintson az 'OK'-ra.
NewFolderName=Új könyvtár

; *** "Welcome" wizard page
WelcomeLabel1=Üdvözli a(z) [name] Telepítõvarázslója.
WelcomeLabel2=A(z) [name/ver] telepítésre kerül a számítógépén.%n%nAjánlott minden, egyéb futó alkalmazás bezárása a folytatás elõtt.

; *** "Password" wizard page
WizardPassword=Jelszó
PasswordLabel1=Ez a telepítés jelszóval védett.
PasswordLabel3=Kérem adja meg a jelszót, majd kattintson a 'Tovább'-ra. A jelszavak kis- és nagy betû érzékenyek lehetnek.
PasswordEditLabel=&Jelszó:
IncorrectPassword=Az ön által megadott jelszó helytelen. Próbálja újra.

; *** "License Agreement" wizard page
WizardLicense=Licencszerzõdés
LicenseLabel=Olvassa el figyelmesen az információkat folytatás elõtt.
LicenseLabel3=Kérem, olvassa el az alábbi licencszerzõdést. A telepítés folytatásához, el kell fogadnia a szerzõdést.
LicenseAccepted=&Elfogadom a szerzõdést
LicenseNotAccepted=&Nem fogadom el a szerzõdést

; *** "Information" wizard pages
WizardInfoBefore=Információk
InfoBeforeLabel=Olvassa el a következõ fontos információkat a folytatás elõtt.
InfoBeforeClickLabel=Ha készen áll, kattintson a 'Tovább'-ra.
WizardInfoAfter=Információk
InfoAfterLabel=Olvassa el a következõ fontos információkat a folytatás elõtt.
InfoAfterClickLabel=Ha készen áll, kattintson a 'Tovább'-ra.

; *** "User Information" wizard page
WizardUserInfo=Felhasználó adatai
UserInfoDesc=Kérem, adja meg az adatait
UserInfoName=&Felhasználónév:
UserInfoOrg=&Szervezet:
UserInfoSerial=&Sorozatszám:
UserInfoNameRequired=Meg kell adnia egy nevet.

; *** "Select Destination Location" wizard page
WizardSelectDir=Válasszon célkönyvtárat
SelectDirDesc=Hova települjön a(z) [name]?
SelectDirLabel3=A(z) [name] az alábbi könyvtárba lesz telepítve. 
SelectDirBrowseLabel=A folytatáshoz, kattintson a 'Tovább'-ra. Ha másik könyvtárat választana, kattintson a 'Tallózás'-ra.
DiskSpaceGBLabel=At least [gb] GB szabad területre van szükség.
DiskSpaceMBLabel=Legalább [mb] MB szabad területre van szükség.
CannotInstallToNetworkDrive=A Telepítõ nem tud hálózati meghajtóra telepíteni.
CannotInstallToUNCPath=A Telepítõ nem tud hálózati UNC elérési útra telepíteni.
InvalidPath=Teljes útvonalat adjon meg, a meghajtó betûjelével; például:%n%nC:\Alkalmazás%n%nvagy egy hálózati útvonalat a következõ alakban:%n%n\\kiszolgáló\megosztás
InvalidDrive=A kiválasztott meghajtó vagy hálózati megosztás nem létezik vagy nem elérhetõ. Válasszon egy másikat.
DiskSpaceWarningTitle=Nincs elég szabad terület
DiskSpaceWarning=A Telepítõnek legalább %1 KB szabad lemezterületre van szüksége, viszont a kiválasztott meghajtón csupán %2 KB áll rendelkezésre.%n%nMindenképpen folytatja?
DirNameTooLong=A könyvtár neve vagy az útvonal túl hosszú.
InvalidDirName=A könyvtár neve érvénytelen.
BadDirName32=A könyvtárak nevei ezen karakterek egyikét sem tartalmazhatják:%n%n%1
DirExistsTitle=A könyvtár már létezik
DirExists=A könyvtár:%n%n%1%n%nmár létezik. Mindenképp ide akar telepíteni?
DirDoesntExistTitle=A könyvtár nem létezik
DirDoesntExist=A könyvtár:%n%n%1%n%nnem létezik. Szeretné létrehozni?

; *** "Select Components" wizard page
WizardSelectComponents=Összetevõk kiválasztása
SelectComponentsDesc=Mely összetevõk kerüljenek telepítésre?
SelectComponentsLabel2=Jelölje ki a telepítendõ összetevõket; törölje a telepíteni nem kívánt összetevõket. Kattintson a 'Tovább'-ra, ha készen áll a folytatásra.
FullInstallation=Teljes telepítés
; if possible don't translate 'Compact' as 'Minimal' (I mean 'Minimal' in your language)
CompactInstallation=Szokásos telepítés
CustomInstallation=Egyéni telepítés
NoUninstallWarningTitle=Létezõ összetevõ
NoUninstallWarning=A telepítõ úgy találta, hogy a következõ összetevõk már telepítve vannak a számítógépre:%n%n%1%n%nEzen összetevõk kijelölésének törlése, nem távolítja el azokat a számítógéprõl.%n%nMindenképpen folytatja?
ComponentSize1=%1 KB
ComponentSize2=%1 MB
ComponentsDiskSpaceMBLabel=A jelenlegi kijelölés legalább [gb] GB lemezterületet igényel.
ComponentsDiskSpaceMBLabel=A jelenlegi kijelölés legalább [mb] MB lemezterületet igényel.

; *** "Select Additional Tasks" wizard page
WizardSelectTasks=További feladatok
SelectTasksDesc=Mely kiegészítõ feladatok kerüljenek végrehajtásra?
SelectTasksLabel2=Jelölje ki, mely kiegészítõ feladatokat hajtsa végre a Telepítõ a(z) [name] telepítése során, majd kattintson a 'Tovább'-ra.

; *** "Select Start Menu Folder" wizard page
WizardSelectProgramGroup=Start Menü könyvtára
SelectStartMenuFolderDesc=Hova helyezze a Telepítõ a program parancsikonjait?
SelectStartMenuFolderLabel3=A Telepítõ a program parancsikonjait a Start menü következõ mappájában fogja létrehozni.
SelectStartMenuFolderBrowseLabel=A folytatáshoz kattintson a 'Tovább'-ra. Ha másik mappát választana, kattintson a 'Tallózás'-ra.
MustEnterGroupName=Meg kell adnia egy mappanevet.
GroupNameTooLong=A könyvtár neve vagy az útvonal túl hosszú.
InvalidGroupName=A könyvtár neve érvénytelen.
BadGroupName=A könyvtárak nevei ezen karakterek egyikét sem tartalmazhatják:%n%n%1
NoProgramGroupCheck2=&Ne hozzon létre mappát a Start menüben

; *** "Ready to Install" wizard page
WizardReady=Készen állunk a telepítésre
ReadyLabel1=A Telepítõ készen áll, a(z) [name] számítógépre telepítéshez.
ReadyLabel2a=Kattintson a 'Telepítés'-re a folytatáshoz, vagy a "Vissza"-ra a beállítások áttekintéséhez vagy megváltoztatásához.
ReadyLabel2b=Kattintson a 'Telepítés'-re a folytatáshoz.
ReadyMemoUserInfo=Felhasználó adatai:
ReadyMemoDir=Telepítés célkönyvtára:
ReadyMemoType=Telepítés típusa:
ReadyMemoComponents=Választott összetevõk:
ReadyMemoGroup=Start menü mappája:
ReadyMemoTasks=Kiegészítõ feladatok:

; *** "Preparing to Install" wizard page
WizardPreparing=Felkészülés a telepítésre
PreparingDesc=A Telepítõ felkészül a(z) [name] számítógépre történõ telepítéshez.
PreviousInstallNotCompleted=gy korábbi program telepítése/eltávolítása nem fejezõdött be. Újra kell indítania a számítógépét a másik telepítés befejezéséhez.%n%nA számítógépe újraindítása után ismét futtassa a Telepítõt a(z) [name] telepítésének befejezéséhez.
CannotContinue=A telepítés nem folytatható. A kilépéshez kattintson a 'Mégse'-re
ApplicationsFound=A következõ alkalmazások olyan fájlokat használnak, amelyeket a Telepítõnek frissíteni kell. Ajánlott, hogy engedélyezze a Telepítõnek ezen alkalmazások automatikus bezárását.
ApplicationsFound2=A következõ alkalmazások olyan fájlokat használnak, amelyeket a Telepítõnek frissíteni kell. Ajánlott, hogy engedélyezze a Telepítõnek ezen alkalmazások automatikus bezárását. A telepítés befejezése után a Telepítõ megkísérli az alkalmazások újraindítását.
CloseApplications=&Alkalmazások automatikus bezárása
DontCloseApplications=&Ne zárja be az alkalmazásokat
ErrorCloseApplications=A Telepítõ nem tudott minden alkalmazást automatikusan bezárni. A folytatás elõtt ajánlott minden, a Telepítõ által frissítendõ fájlokat használó alkalmazást bezárni.
PrepareToInstallNeedsRestart=A telepítõnek újra kell indítania a számítógépet. Újraindítást követõen, futtassa újból a telepítõt, a [name] telepítésének befejezéséhez .%n%nÚjra szeretné indítani most a számítógépet?

; *** "Installing" wizard page
WizardInstalling=Telepítés
InstallingLabel=Kérem várjon, amíg a(z) [name] telepítése zajlik.

; *** "Setup Completed" wizard page
FinishedHeadingLabel=A(z) [name] telepítésének befejezése
FinishedLabelNoIcons=A Telepítõ végzett a(z) [name] telepítésével.
FinishedLabel=A Telepítõ végzett a(z) [name] telepítésével. Az alkalmazást a létrehozott ikonok kiválasztásával indíthatja.
ClickFinish=Kattintson a 'Befejezés'-re a kilépéshez.
FinishedRestartLabel=A(z) [name] telepítésének befejezéséhez újra kell indítani a számítógépet. Újraindítja most?
FinishedRestartMessage=A(z) [name] telepítésének befejezéséhez, a Telepítõnek újra kell indítani a számítógépet.%n%nÚjraindítja most?
ShowReadmeCheck=Igen, szeretném elolvasni a FONTOS fájlt
YesRadio=&Igen, újraindítás most
NoRadio=&Nem, késõbb indítom újra
; used for example as 'Run MyProg.exe'
RunEntryExec=%1 futtatása
; used for example as 'View Readme.txt'
RunEntryShellExec=%1 megtekintése

; *** "Setup Needs the Next Disk" stuff
ChangeDiskTitle=A Telepítõnek szüksége van a következõ lemezre
SelectDiskLabel2=Helyezze be a(z) %1. lemezt és kattintson az 'OK'-ra.%n%nHa a fájlok a lemez egy a megjelenítettõl különbözõ mappájában találhatók, írja be a helyes útvonalat vagy kattintson a 'Tallózás'-ra.
PathLabel=Ú&tvonal:
FileNotInDir2=A(z) "%1" fájl nem található a következõ helyen: "%2". Helyezze be a megfelelõ lemezt vagy válasszon egy másik mappát.
SelectDirectoryLabel=Adja meg a következõ lemez helyét.

; *** Installation phase messages
SetupAborted=A telepítés nem fejezõdött be.%n%nHárítsa el a hibát és futtassa újból a Telepítõt.
AbortRetryIgnoreSelectAction=Válasszon mûveletet
AbortRetryIgnoreRetry=&Újra
AbortRetryIgnoreIgnore=&Hiba elvetése és folytatás
AbortRetryIgnoreCancel=Telepítés megszakítása

; *** Installation status messages
StatusClosingApplications=Alkalmazások bezárása...
StatusCreateDirs=Könyvtárak létrehozása...
StatusExtractFiles=Fájlok kibontása...
StatusCreateIcons=Parancsikonok létrehozása...
StatusCreateIniEntries=INI bejegyzések létrehozása...
StatusCreateRegistryEntries=Rendszerleíró bejegyzések létrehozása...
StatusRegisterFiles=Fájlok regisztrálása...
StatusSavingUninstall=Eltávolító információk mentése...
StatusRunProgram=Telepítés befejezése...
StatusRestartingApplications=Alkalmazások újraindítása...
StatusRollback=Változtatások visszavonása...

; *** Misc. errors
ErrorInternal2=Belsõ hiba: %1
ErrorFunctionFailedNoCode=Sikertelen %1
ErrorFunctionFailed=Sikertelen %1; kód: %2
ErrorFunctionFailedWithMessage=Sikertelen %1; kód: %2.%n%3
ErrorExecutingProgram=Nem hajtható végre a fájl:%n%1

; *** Registry errors
ErrorRegOpenKey=Nem nyitható meg a rendszerleíró kulcs:%n%1\%2
ErrorRegCreateKey=Nem hozható létre a rendszerleíró kulcs:%n%1\%2
ErrorRegWriteKey=Nem módosítható a rendszerleíró kulcs:%n%1\%2

; *** INI errors
ErrorIniEntry=Bejegyzés létrehozása sikertelen a következõ INI fájlban: "%1".

; *** File copying errors
FileAbortRetryIgnoreSkipNotRecommended=&Fájl kihagyása (nem ajánlott)
FileAbortRetryIgnoreIgnoreNotRecommended=&Hiba elvetése és folytatás (nem ajánlott)
SourceIsCorrupted=A forrásfájl megsérült
SourceDoesntExist=A(z) "%1" forrásfájl nem létezik
ExistingFileReadOnly2=A fájl csak olvashatóként van jelölve.
ExistingFileReadOnlyRetry=Csak &olvasható tulajdonság eltávolítása és újra próbálkozás 
ExistingFileReadOnlyKeepExisting=&Létezõ fájl megtartása
ErrorReadingExistingDest=Hiba lépett fel a fájl olvasása közben:
FileExists=A fájl már létezik.%n%nFelül kívánja írni?
ExistingFileNewer=A létezõ fájl újabb a telepítésre kerülõnél. Ajánlott a létezõ fájl megtartása.%n%nMeg kívánja tartani a létezõ fájlt?
ErrorChangingAttr=Hiba lépett fel a fájl attribútumának módosítása közben:
ErrorCreatingTemp=Hiba lépett fel a fájl telepítési könyvtárban történõ létrehozása közben:
ErrorReadingSource=Hiba lépett fel a forrásfájl olvasása közben:
ErrorCopying=Hiba lépett fel a fájl másolása közben:
ErrorReplacingExistingFile=Hiba lépett fel a létezõ fájl cseréje közben:
ErrorRestartReplace=A fájl cseréje az újraindítás után sikertelen volt:
ErrorRenamingTemp=Hiba lépett fel fájl telepítési könyvtárban történõ átnevezése közben:
ErrorRegisterServer=Nem lehet regisztrálni a DLL-t/OCX-et: %1
ErrorRegSvr32Failed=Sikertelen RegSvr32. A visszaadott kód: %1
ErrorRegisterTypeLib=Nem lehet regisztrálni a típustárat: %1

; *** Uninstall display name markings
; used for example as 'My Program (32-bit)'
UninstallDisplayNameMark=%1 (%2)
; used for example as 'My Program (32-bit, All users)'
UninstallDisplayNameMarks=%1 (%2, %3)
UninstallDisplayNameMark32Bit=32-bit
UninstallDisplayNameMark64Bit=64-bit
UninstallDisplayNameMarkAllUsers=Minden felhasználó
UninstallDisplayNameMarkCurrentUser=Jelenlegi felhasználó

; *** Post-installation errors
ErrorOpeningReadme=Hiba lépett fel a FONTOS fájl megnyitása közben.
ErrorRestartingComputer=A Telepítõ nem tudta újraindítani a számítógépet. Indítsa újra kézileg.

; *** Uninstaller messages
UninstallNotFound=A(z) "%1" fájl nem létezik. Nem távolítható el.
UninstallOpenError=A(z) "%1" fájl nem nyitható meg. Nem távolítható el.
UninstallUnsupportedVer=A(z) "%1" eltávolítási naplófájl formátumát nem tudja felismerni az eltávolító jelen verziója. Az eltávolítás nem folytatható
UninstallUnknownEntry=Egy ismeretlen bejegyzés (%1) található az eltávolítási naplófájlban
ConfirmUninstall=Biztosan el kívánja távolítani a(z) %1 programot és minden összetevõjét?
UninstallOnlyOnWin64=Ezt a telepítést csak 64-bites Windowson lehet eltávolítani.
OnlyAdminCanUninstall=Ezt a telepítést csak adminisztrációs jogokkal rendelkezõ felhasználó távolíthatja el.
UninstallStatusLabel=Legyen türelemmel, amíg a(z) %1 számítógépérõl történõ eltávolítása befejezõdik.
UninstalledAll=A(z) %1 sikeresen el lett távolítva a számítógéprõl.
UninstalledMost=A(z) %1 eltávolítása befejezõdött.%n%nNéhány elemet nem lehetett eltávolítani. Törölje kézileg.
UninstalledAndNeedsRestart=A(z) %1 eltávolításának befejezéséhez újra kell indítania a számítógépét.%n%nÚjraindítja most?
UninstallDataCorrupted=A(z) "%1" fájl sérült. Nem távolítható el.

; *** Uninstallation phase messages
ConfirmDeleteSharedFileTitle=Törli a megosztott fájlt?
ConfirmDeleteSharedFile2=A rendszer azt jelzi, hogy a következõ megosztott fájlra már nincs szüksége egyetlen programnak sem. Eltávolítja a megosztott fájlt?%n%nHa más programok még mindig használják a megosztott fájlt, akkor az eltávolítása után lehet, hogy nem fognak megfelelõen mûködni. Ha bizonytalan, válassza a Nemet. A fájl megtartása nem okoz problémát a rendszerben.
SharedFileNameLabel=Fájlnév:
SharedFileLocationLabel=Helye:
WizardUninstalling=Eltávolítás állapota
StatusUninstalling=%1 eltávolítása...

; *** Shutdown block reasons
ShutdownBlockReasonInstallingApp=%1 telepítése.
ShutdownBlockReasonUninstallingApp=%1 eltávolítása.

; The custom messages below aren't used by Setup itself, but if you make
; use of them in your scripts, you'll want to translate them.

[CustomMessages]

NameAndVersion=%1, verzió: %2
AdditionalIcons=További parancsikonok:
CreateDesktopIcon=&Asztali ikon létrehozása
CreateQuickLaunchIcon=&Gyorsindító parancsikon létrehozása
ProgramOnTheWeb=%1 az interneten
UninstallProgram=Eltávolítás - %1
LaunchProgram=Indítás %1
AssocFileExtension=A(z) %1 &társítása a(z) %2 fájlkiterjesztéssel
AssocingFileExtension=A(z) %1 társítása a(z) %2 fájlkiterjesztéssel...
AutoStartProgramGroupDescription=Indítópult:
AutoStartProgram=%1 automatikus indítása
AddonHostProgramNotFound=A(z) %1 nem található a kiválasztott könyvtárban.%n%nMindenképpen folytatja?
