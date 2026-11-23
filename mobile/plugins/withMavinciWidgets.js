/*
 * Widżety Mavinci na iPhonie i iPadzie — rozszerzenie WidgetKit dodawane przy `expo prebuild` (EAS Build).
 *
 * Te same widżety co na pulpicie Maca: „Moje zadania”, „Zadania prywatne”, „Kalendarz” i „Spotkania” — na ekranie głównym
 * (mały, średni, duży; na iPadzie także bardzo duży) i na ekranie blokady (prostokątny, w linii). Kod Swift
 * z `desktop/mac/Sources/MavinciWidgets/*.swift` oraz `desktop/mac/Sources/Mavinci/Finder/FinderShared.swift` (różnice iOS —
 * `#if os(iOS)`), kopiowany do `ios/MavinciWidgets/` przy każdym prebuildzie (jedno źródło dla Maca i iOS). `FinderShared.swift`
 * trafia tu jako `WidgetsFinderShared.swift` — ta sama nazwa pliku co w rozszerzeniu Plików skleiłaby oba cele w projekcie Xcode.
 *
 * Sesja: widżet używa sesji rozszerzenia Plików z grupy aplikacji `group.com.mavinci.crm` (zapisuje ją moduł
 * `modules/mavinci-files` po zalogowaniu; odświeżanie tokenu pod wspólną blokadą), więc działa także przy zamkniętej aplikacji.
 *
 * Plugin:
 *  - kopiuje źródła, zapisuje Info.plist (`com.apple.widgetkit-extension`) i uprawnienia rozszerzenia (grupa aplikacji),
 *  - dodaje cel `MavinciWidgets` (app extension, iOS 17+) do projektu Xcode i osadza go w aplikacji,
 *  - dopisuje grupę aplikacji do uprawnień aplikacji,
 *  - zgłasza rozszerzenie EAS (`extra.eas.build.experimental.ios.appExtensions`), żeby EAS przygotował certyfikat i profil
 *    dla `com.mavinci.crm.Widgets`.
 * Widżety wymagają nowej wersji aplikacji (EAS Build) — aktualizacja OTA ich nie doda. Na iOS 16 i starszym ich nie ma
 * (aplikacja działa jak dotąd).
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'MavinciWidgets';
const APP_GROUP = 'group.com.mavinci.crm';
const DEPLOYMENT_TARGET = '17.0';

/** Pliki wspólne z aplikacją na Maca (ścieżka względem `desktop/mac/Sources`) → nazwa w `ios/MavinciWidgets/`. */
const SHARED_SOURCES = [['Mavinci/Finder/FinderShared.swift', 'WidgetsFinderShared.swift']];

const extensionBundleId = (config) => `${config.ios.bundleIdentifier}.Widgets`;

/** Źródła widżetów: `[ścieżka źródłowa, nazwa pliku w celu]`. */
function widgetSources(projectRoot) {
  const root = path.resolve(projectRoot, '..', 'desktop', 'mac', 'Sources');
  const widgetsDir = path.join(root, 'MavinciWidgets');
  if (!fs.existsSync(widgetsDir)) {
    throw new Error(`[withMavinciWidgets] Brak źródeł widżetów: ${widgetsDir} (EAS musi wysłać całe repozytorium).`);
  }
  const widgets = fs.readdirSync(widgetsDir).filter((name) => name.endsWith('.swift')).sort()
    .map((name) => [path.join(widgetsDir, name), name]);
  const shared = SHARED_SOURCES.map(([relative, name]) => [path.join(root, relative), name]);
  for (const [file] of shared) {
    if (!fs.existsSync(file)) throw new Error(`[withMavinciWidgets] Brak pliku ${file}.`);
  }
  const all = [...widgets, ...shared];
  const names = all.map(([, name]) => name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`[withMavinciWidgets] Dwa pliki o nazwie ${duplicate}.`);
  return all;
}

const infoPlist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>pl</string>
  <key>CFBundleDisplayName</key>
  <string>Mavinci</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;

const entitlementsPlist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>
`;

/** Źródła, Info.plist i uprawnienia w `ios/MavinciWidgets/` (katalog zawsze od nowa — bez starych plików). */
const withExtensionFiles = (config) => withDangerousMod(config, ['ios', async (cfg) => {
  const sources = widgetSources(cfg.modRequest.projectRoot);
  const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, name] of sources) fs.copyFileSync(file, path.join(dir, name));
  fs.writeFileSync(path.join(dir, `${TARGET}-Info.plist`), infoPlist());
  fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), entitlementsPlist());
  return cfg;
}]);

/** Grupa aplikacji w uprawnieniach aplikacji (sesja i adresy serwera wspólne z rozszerzeniami). */
const withAppGroup = (config) => withEntitlementsPlist(config, (cfg) => {
  const key = 'com.apple.security.application-groups';
  const groups = Array.isArray(cfg.modResults[key]) ? cfg.modResults[key] : [];
  if (!groups.includes(APP_GROUP)) groups.push(APP_GROUP);
  cfg.modResults[key] = groups;
  return cfg;
});

const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const plain = (value) => String(value).replace(/^"|"$/g, '');

/** Cel `MavinciWidgets` (app extension) w projekcie Xcode, osadzony w aplikacji („Copy Files” → PlugIns). */
const withExtensionTarget = (config) => withXcodeProject(config, (cfg) => {
  const project = cfg.modResults;
  const objects = project.hash.project.objects;
  // Cel już jest (prebuild bez `--clean`) — nazwa zapisana z cudzysłowami albo bez.
  const existing = Object.keys(objects.PBXNativeTarget || {})
    .some((key) => !key.endsWith('_comment') && plain(objects.PBXNativeTarget[key].name) === TARGET);
  if (existing) return cfg;
  const sources = widgetSources(cfg.modRequest.projectRoot).map(([, name]) => name);
  const files = [...sources, `${TARGET}-Info.plist`, `${TARGET}.entitlements`];

  // Biblioteka `xcode` dołącza do grupy istniejący plik o tej samej ścieżce (np. z innego celu) — nazwy muszą być nowe.
  const references = objects.PBXFileReference || {};
  const taken = new Set(Object.keys(references).filter((key) => !key.endsWith('_comment')).map((key) => plain(references[key].path)));
  const clash = files.find((name) => taken.has(name));
  if (clash) throw new Error(`[withMavinciWidgets] Plik ${clash} jest już w projekcie Xcode — zmień nazwę pliku widżetów.`);

  // Grupa z plikami rozszerzenia w głównej grupie projektu.
  const group = project.addPbxGroup(files, TARGET, TARGET);
  const mainGroup = project.getFirstProject().firstProject.mainGroup;
  project.addToPbxGroup(group.uuid, mainGroup);

  // Biblioteka `xcode` zakłada, że te sekcje istnieją (inaczej `addTarget` przerywa się przy zależności celów).
  objects.PBXTargetDependency = objects.PBXTargetDependency || {};
  objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

  const target = project.addTarget(TARGET, 'app_extension', TARGET, extensionBundleId(cfg));
  project.addBuildPhase(sources, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

  // Osadzenie w aplikacji: faza „Copy Files” (PlugIns) utworzona dla tego celu (ostatnia o tej nazwie) z produktem
  // rozszerzenia, zaraz po „Resources” aplikacji — przed skryptami (React Native, CocoaPods); na końcu listy faz Xcode 15+
  // zgłasza cykl zależności. Biblioteka szuka fazy „Copy Files” po nazwie, więc produkt mógł trafić do fazy rozszerzenia Plików.
  const appTarget = project.getFirstTarget();
  const phases = appTarget.firstTarget.buildPhases;
  const productRef = target.pbxNativeTarget.productReference;
  const productBuildFile = Object.keys(objects.PBXBuildFile).find((key) => !key.endsWith('_comment') && objects.PBXBuildFile[key].fileRef === productRef);
  const embedIndex = phases.map((phase) => phase.comment).lastIndexOf('Copy Files');
  const embed = embedIndex >= 0 ? objects.PBXCopyFilesBuildPhase[phases[embedIndex].value] : null;
  if (!embed || !productBuildFile) throw new Error('[withMavinciWidgets] Nie udało się osadzić rozszerzenia w aplikacji.');
  if (!embed.files.some((file) => file.value === productBuildFile)) embed.files.push({ value: productBuildFile, comment: `${TARGET}.appex in Copy Files` });
  for (const key of Object.keys(objects.PBXCopyFilesBuildPhase)) {
    const phase = objects.PBXCopyFilesBuildPhase[key];
    if (key.endsWith('_comment') || phase === embed || !Array.isArray(phase.files)) continue;
    phase.files = phase.files.filter((file) => file.value !== productBuildFile);
  }
  const resourcesIndex = phases.findIndex((phase) => phase.comment === 'Resources');
  if (resourcesIndex >= 0 && embedIndex > resourcesIndex + 1) {
    const [entry] = phases.splice(embedIndex, 1);
    phases.splice(resourcesIndex + 1, 0, entry);
  }

  // Biblioteka `xcode` zapisuje brakujące pola jako „undefined” (np. `explicitFileType = undefined`) — usuwamy je.
  const fileReferences = objects.PBXFileReference;
  for (const key of [...group.pbxGroup.children.map((child) => child.value), productRef]) {
    const reference = fileReferences[key];
    if (!reference) continue;
    for (const field of Object.keys(reference)) {
      if (reference[field] === undefined || reference[field] === 'undefined') delete reference[field];
    }
    if (plain(reference.path).endsWith('.entitlements')) reference.lastKnownFileType = 'text.plist.entitlements';
  }
  // Info.plist i uprawnienia nie są zasobami rozszerzenia — bez wpisów PBXBuildFile.
  for (const key of Object.keys(objects.PBXBuildFile)) {
    if (key.endsWith('_comment')) continue;
    const reference = fileReferences[objects.PBXBuildFile[key].fileRef];
    const name = reference ? plain(reference.path) : '';
    if (name === `${TARGET}-Info.plist` || name === `${TARGET}.entitlements`) {
      delete objects.PBXBuildFile[key];
      delete objects.PBXBuildFile[`${key}_comment`];
    }
  }

  // Zespół jak w aplikacji (gdy prebuild go zna; na EAS ustawia go podpisywanie).
  const configurations = project.pbxXCBuildConfigurationSection();
  let team = null;
  const appConfigList = project.pbxXCConfigurationList()[appTarget.firstTarget.buildConfigurationList];
  for (const entry of appConfigList?.buildConfigurations || []) {
    const settings = configurations[entry.value]?.buildSettings;
    if (settings?.DEVELOPMENT_TEAM) team = settings.DEVELOPMENT_TEAM;
  }

  const version = cfg.version || '1.0.0';
  const build = String(cfg.ios?.buildNumber || '1');
  const targetConfigList = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
  for (const entry of targetConfigList.buildConfigurations) {
    const configuration = configurations[entry.value];
    const settings = configuration.buildSettings;
    Object.assign(settings, {
      INFOPLIST_FILE: quote(`${TARGET}/${TARGET}-Info.plist`),
      CODE_SIGN_ENTITLEMENTS: quote(`${TARGET}/${TARGET}.entitlements`),
      CODE_SIGN_STYLE: 'Automatic',
      IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
      SDKROOT: 'iphoneos',
      TARGETED_DEVICE_FAMILY: quote('1,2'),
      SWIFT_VERSION: '5.0',
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CLANG_ENABLE_MODULES: 'YES',
      MARKETING_VERSION: version,
      CURRENT_PROJECT_VERSION: build,
      SWIFT_OPTIMIZATION_LEVEL: configuration.name === 'Debug' ? quote('-Onone') : quote('-O'),
      SWIFT_ACTIVE_COMPILATION_CONDITIONS: configuration.name === 'Debug' ? 'DEBUG' : quote(''),
    });
    if (team) settings.DEVELOPMENT_TEAM = team;
  }
  return cfg;
});

/** EAS: rozszerzenie i jego uprawnienia znane przed budowaniem (certyfikat i profil dla `com.mavinci.crm.Widgets`). */
const withEasExtension = (config) => {
  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.build = config.extra.eas.build || {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental || {};
  config.extra.eas.build.experimental.ios = config.extra.eas.build.experimental.ios || {};
  const ios = config.extra.eas.build.experimental.ios;
  const list = Array.isArray(ios.appExtensions) ? ios.appExtensions.filter((entry) => entry.targetName !== TARGET) : [];
  list.push({
    targetName: TARGET,
    bundleIdentifier: extensionBundleId(config),
    entitlements: { 'com.apple.security.application-groups': [APP_GROUP] },
  });
  ios.appExtensions = list;
  return config;
};

module.exports = function withMavinciWidgets(config) {
  if (!config.ios?.bundleIdentifier) throw new Error('[withMavinciWidgets] Brak ios.bundleIdentifier w app.json.');
  config = withEasExtension(config);
  config = withAppGroup(config);
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  return config;
};
