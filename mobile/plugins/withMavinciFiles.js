/*
 * „Mavinci” w aplikacji Pliki na iPhonie i iPadzie — rozszerzenie File Provider dodawane przy `expo prebuild` (EAS Build).
 *
 * To samo rozszerzenie co „Mavinci” w Finderze na Macu: kod Swift z `desktop/mac/Sources/MavinciFileProvider/*.swift`
 * oraz `desktop/mac/Sources/Mavinci/Finder/{FinderShared,MaterialMedia}.swift` (różnice iOS — `#if os(iOS)` w tych plikach),
 * kopiowany do `ios/MavinciFiles/` przy każdym prebuildzie (jedno źródło dla Maca i iOS). Eventy, Materiały i Dysk
 * (Oferty, Kalkulacje, Umowy, Magazyn, Pracownicy) — ten sam układ co w Finderze, w CRM i w aplikacji.
 *
 * Plugin:
 *  - kopiuje źródła, zapisuje Info.plist i uprawnienia rozszerzenia (grupa aplikacji `group.com.mavinci.crm`),
 *  - dodaje cel `MavinciFiles` (app extension, iOS 16+) do projektu Xcode i osadza go w aplikacji,
 *  - dopisuje grupę aplikacji do uprawnień aplikacji (moduł `modules/mavinci-files` zapisuje tam sesję rozszerzenia),
 *  - zgłasza rozszerzenie EAS (`extra.eas.build.experimental.ios.appExtensions`), żeby EAS przygotował certyfikat i profil.
 * Rozszerzenie wymaga nowej wersji aplikacji (EAS Build) — aktualizacja OTA go nie doda.
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'MavinciFiles';
const APP_GROUP = 'group.com.mavinci.crm';
const DEPLOYMENT_TARGET = '16.0';
const PRINCIPAL_CLASS = 'MavinciFileProviderExtension';

/** Źródła rozszerzenia z aplikacji na Maca (ścieżki względem `desktop/mac/Sources`). */
const SHARED_SOURCES = ['Mavinci/Finder/FinderShared.swift', 'Mavinci/Finder/MaterialMedia.swift'];

const extensionBundleId = (config) => `${config.ios.bundleIdentifier}.Files`;

function macSources(projectRoot) {
  const root = path.resolve(projectRoot, '..', 'desktop', 'mac', 'Sources');
  const providerDir = path.join(root, 'MavinciFileProvider');
  if (!fs.existsSync(providerDir)) {
    throw new Error(`[withMavinciFiles] Brak źródeł rozszerzenia Plików: ${providerDir} (EAS musi wysłać całe repozytorium).`);
  }
  const provider = fs.readdirSync(providerDir).filter((name) => name.endsWith('.swift')).sort().map((name) => path.join(providerDir, name));
  const shared = SHARED_SOURCES.map((relative) => path.join(root, relative));
  for (const file of shared) {
    if (!fs.existsSync(file)) throw new Error(`[withMavinciFiles] Brak pliku ${file}.`);
  }
  const all = [...provider, ...shared];
  const names = all.map((file) => path.basename(file));
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`[withMavinciFiles] Dwa pliki o nazwie ${duplicate}.`);
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
    <string>com.apple.fileprovider-nonui</string>
    <key>NSExtensionPrincipalClass</key>
    <string>${PRINCIPAL_CLASS}</string>
    <key>NSExtensionFileProviderDocumentGroup</key>
    <string>${APP_GROUP}</string>
    <key>NSExtensionFileProviderSupportsEnumeration</key>
    <true/>
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

/** Źródła, Info.plist i uprawnienia w `ios/MavinciFiles/` (katalog zawsze od nowa — bez starych plików). */
const withExtensionFiles = (config) => withDangerousMod(config, ['ios', async (cfg) => {
  const sources = macSources(cfg.modRequest.projectRoot);
  const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const file of sources) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  fs.writeFileSync(path.join(dir, `${TARGET}-Info.plist`), infoPlist());
  fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), entitlementsPlist());
  return cfg;
}]);

/** Grupa aplikacji w uprawnieniach aplikacji (sesja i adresy serwera dla rozszerzenia). */
const withAppGroup = (config) => withEntitlementsPlist(config, (cfg) => {
  const key = 'com.apple.security.application-groups';
  const groups = Array.isArray(cfg.modResults[key]) ? cfg.modResults[key] : [];
  if (!groups.includes(APP_GROUP)) groups.push(APP_GROUP);
  cfg.modResults[key] = groups;
  return cfg;
});

const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;

/** Cel `MavinciFiles` (app extension) w projekcie Xcode, osadzony w aplikacji („Copy Files” → PlugIns). */
const withExtensionTarget = (config) => withXcodeProject(config, (cfg) => {
  const project = cfg.modResults;
  const objects = project.hash.project.objects;
  // Cel już jest (prebuild bez `--clean`) — nazwa zapisana z cudzysłowami albo bez.
  const existing = Object.keys(objects.PBXNativeTarget || {})
    .some((key) => !key.endsWith('_comment') && String(objects.PBXNativeTarget[key].name).replace(/^"|"$/g, '') === TARGET);
  if (existing) return cfg;
  const sources = macSources(cfg.modRequest.projectRoot).map((file) => path.basename(file));
  const files = [...sources, `${TARGET}-Info.plist`, `${TARGET}.entitlements`];

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

  // Osadzenie w aplikacji: faza „Copy Files” (PlugIns) z produktem rozszerzenia, zaraz po „Resources” aplikacji — przed
  // skryptami (React Native, CocoaPods); na końcu listy faz Xcode 15+ zgłasza cykl zależności.
  const appTarget = project.getFirstTarget();
  const phases = appTarget.firstTarget.buildPhases;
  const productRef = target.pbxNativeTarget.productReference;
  const productBuildFile = Object.keys(objects.PBXBuildFile).find((key) => !key.endsWith('_comment') && objects.PBXBuildFile[key].fileRef === productRef);
  const embedIndex = phases.map((phase) => phase.comment).lastIndexOf('Copy Files');
  const embed = embedIndex >= 0 ? objects.PBXCopyFilesBuildPhase[phases[embedIndex].value] : null;
  if (!embed || !productBuildFile) throw new Error('[withMavinciFiles] Nie udało się osadzić rozszerzenia w aplikacji.');
  if (!embed.files.some((file) => file.value === productBuildFile)) embed.files.push({ value: productBuildFile, comment: `${TARGET}.appex in Copy Files` });
  for (const key of Object.keys(objects.PBXCopyFilesBuildPhase)) {
    // Produkt rozszerzenia tylko w naszej fazie (biblioteka szuka fazy „Copy Files” po nazwie — mogła trafić do innej).
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
  const references = objects.PBXFileReference;
  const plain = (value) => String(value).replace(/^"|"$/g, '');
  for (const key of [...group.pbxGroup.children.map((child) => child.value), productRef]) {
    const reference = references[key];
    if (!reference) continue;
    for (const field of Object.keys(reference)) {
      if (reference[field] === undefined || reference[field] === 'undefined') delete reference[field];
    }
    if (plain(reference.path).endsWith('.entitlements')) reference.lastKnownFileType = 'text.plist.entitlements';
  }
  // Info.plist i uprawnienia nie są zasobami rozszerzenia — bez wpisów PBXBuildFile.
  for (const key of Object.keys(objects.PBXBuildFile)) {
    if (key.endsWith('_comment')) continue;
    const reference = references[objects.PBXBuildFile[key].fileRef];
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

/** EAS: rozszerzenie i jego uprawnienia znane przed budowaniem (certyfikat i profil dla `com.mavinci.crm.Files`). */
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

module.exports = function withMavinciFiles(config) {
  if (!config.ios?.bundleIdentifier) throw new Error('[withMavinciFiles] Brak ios.bundleIdentifier w app.json.');
  config = withEasExtension(config);
  config = withAppGroup(config);
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  return config;
};
