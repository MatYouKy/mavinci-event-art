# „Mavinci” w aplikacji Pliki — moduł natywny aplikacji (sesja rozszerzenia w grupie aplikacji, rejestracja domeny File Provider).
# Nazwa poda inna niż cel rozszerzenia `MavinciFiles` (mobile/plugins/withMavinciFiles.js) — bez dwóch modułów Swift o tej samej nazwie.
Pod::Spec.new do |s|
  s.name           = 'MavinciFilesBridge'
  s.version        = '1.0.0'
  s.summary        = 'Mavinci w aplikacji Pliki (File Provider)'
  s.description    = 'Zapisuje sesję i adresy serwera dla rozszerzenia „Mavinci” w aplikacji Pliki i rejestruje jego domenę.'
  s.author         = 'Mavinci'
  s.homepage       = 'https://mavinci.pl'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'FileProvider'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = '**/*.{h,m,swift}'
end
