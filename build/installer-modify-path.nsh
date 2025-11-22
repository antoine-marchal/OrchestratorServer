!macro addToUserPath
  Push $0
  Push $1
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR"
  ${If} $0 != ""
    StrCpy $0 "$0;$1"
  ${Else}
    StrCpy $0 $1
  ${EndIf}
  WriteRegExpandStr HKCU "Environment" "Path" $0
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment"
  Pop $1
  Pop $0
!macroend

!macro removeFromUserPath
  ; Optionnel, peut être laissé vide ou "dummy" pour Electron-builder
!macroend

!macro customInstall
  !insertmacro addToUserPath
!macroend

!macro customUnInstall
  !insertmacro removeFromUserPath
!macroend
