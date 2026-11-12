import { Extension, Node, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CONTRACT_CLAUSE_SLOTS } from '@/lib/CRM/contracts/contractClauseSlots';
import type { ContractStyleId } from '@/lib/CRM/contracts/contractDocumentStyles';
import {
  CONTRACT_CONDITION_ATTRIBUTE,
  describeContractCondition,
  evaluateContractCondition,
  type ContractOption,
} from '@/lib/CRM/contracts/contractConditions';

/**
 * Rozszerzenia edytora umów (TipTap): style akapitów jak w Wordzie, atrybuty szablonu (warunki, klauzule wspólne,
 * numery §), miejsca na klauzule produktów i podświetlenie pól `{{…}}`.
 */

const MANAGED_DATA_ATTRIBUTES = new Set([
  'data-style', 'data-contract-keep-with-next', 'data-contract-clause-slot', 'data-clause-label', CONTRACT_CONDITION_ATTRIBUTE,
  // Wyliczane przy podziale na strony (numer 1.2, kontynuacja listy na następnej stronie) — nie zapisujemy.
  'data-contract-outline-number', 'data-contract-list-continuation', 'data-contract-list-item-continuation',
]);

/** Pozostałe atrybuty szablonu (`data-contract-shared-clause`, `data-paragraph-number`…) — bez zmian. */
const collectExtraAttributes = (element: HTMLElement) => {
  const extra: Record<string, string> = {};
  Array.from(element.attributes).forEach(({ name, value }) => {
    if (name.startsWith('data-') && !MANAGED_DATA_ATTRIBUTES.has(name) && !name.startsWith('data-pm')) extra[name] = value;
  });
  if (element.classList.contains('product-contract-clause')) extra.class = 'product-contract-clause';
  return Object.keys(extra).length ? extra : null;
};

/** Styl bezpośredni bloku (np. odstęp nad podpisami w tabeli) bez wyrównania — to ustawia przycisk wyrównania. */
const blockStyleFrom = (element: HTMLElement) => {
  const declarations = (element.getAttribute('style') || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !/^text-align\s*:/i.test(part) && !/^min-width\s*:/i.test(part));
  return declarations.length ? declarations.join(';') + ';' : null;
};

const STYLE_TYPES = ['paragraph', 'listItem'];
const PASSTHROUGH_TYPES = ['paragraph', 'listItem', 'orderedList', 'bulletList', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image'];

export const ContractAttributes = Extension.create({
  name: 'contractAttributes',
  addGlobalAttributes() {
    return [
      {
        types: STYLE_TYPES,
        attributes: {
          contractStyle: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-style'),
            renderHTML: (attributes) => (attributes.contractStyle ? { 'data-style': attributes.contractStyle } : {}),
          },
        },
      },
      {
        types: ['paragraph'],
        attributes: {
          keepWithNext: {
            default: false,
            parseHTML: (element) => element.getAttribute('data-contract-keep-with-next') === 'true',
            renderHTML: (attributes) => (attributes.keepWithNext ? { 'data-contract-keep-with-next': 'true' } : {}),
          },
        },
      },
      {
        // Warunek widoczności akapitu lub punktu (`contractConditions.ts`).
        types: STYLE_TYPES,
        attributes: {
          condition: {
            default: null,
            parseHTML: (element) => element.getAttribute(CONTRACT_CONDITION_ATTRIBUTE),
            renderHTML: (attributes) => (attributes.condition ? { [CONTRACT_CONDITION_ATTRIBUTE]: attributes.condition } : {}),
          },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          contractStyle: {
            default: 'table',
            parseHTML: (element) => element.getAttribute('data-style') || 'table',
            renderHTML: (attributes) => ({ 'data-style': attributes.contractStyle || 'table' }),
          },
        },
      },
      {
        types: PASSTHROUGH_TYPES,
        attributes: {
          extraAttributes: {
            default: null,
            parseHTML: (element) => collectExtraAttributes(element),
            renderHTML: (attributes) => attributes.extraAttributes || {},
          },
          blockStyle: {
            default: null,
            parseHTML: (element) => blockStyleFrom(element),
            renderHTML: (attributes) => (attributes.blockStyle ? { style: attributes.blockStyle } : {}),
          },
        },
      },
    ];
  },
});

// MARK: Sekcja warunkowa (kilka akapitów, punktów, tabel pod jednym warunkiem)

export const ContractConditionSection = Node.create({
  name: 'contractSection',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      condition: {
        default: '',
        parseHTML: (element) => element.getAttribute(CONTRACT_CONDITION_ATTRIBUTE) || '',
        renderHTML: (attributes) => ({ [CONTRACT_CONDITION_ATTRIBUTE]: attributes.condition || '' }),
      },
    };
  },
  parseHTML() {
    return [{ tag: `div[${CONTRACT_CONDITION_ATTRIBUTE}]` }, { tag: `section[${CONTRACT_CONDITION_ATTRIBUTE}]` }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes, 0];
  },
});

export interface ContractConditionsStorage {
  options: ContractOption[];
  fieldLabels: Record<string, string>;
  /** Symulacja „Pokaż jako” — zmienne warunków; `null` — pokaż wszystko. */
  simulate: Record<string, string> | null;
}

const conditionKey = new PluginKey('contractConditions');
const CONDITIONED_TYPES = new Set(['paragraph', 'listItem', 'contractSection']);

/**
 * Etykiety warunków przy akapitach i sekcjach („Klient: firma”, „Opcja: Nocleg…”) oraz przygaszenie treści, której
 * nie będzie w umowie przy wybranej symulacji („Pokaż jako”).
 */
export const ContractConditions = Extension.create<Record<string, never>, ContractConditionsStorage>({
  name: 'contractConditions',
  addStorage() {
    return { options: [], fieldLabels: {}, simulate: null };
  },
  addProseMirrorPlugins() {
    const storage = () => this.storage as ContractConditionsStorage;
    const build = (doc: PMNode) => {
      const { options, fieldLabels, simulate } = storage();
      const decorations: Decoration[] = [];
      doc.descendants((node, position) => {
        if (!CONDITIONED_TYPES.has(node.type.name) || !node.attrs.condition) return;
        const visible = simulate ? evaluateContractCondition(node.attrs.condition, simulate) : null;
        decorations.push(Decoration.node(position, position + node.nodeSize, {
          'data-condition-label': describeContractCondition(node.attrs.condition, { options, fieldLabels }),
          class: visible === false ? 'contract-editor-cond contract-editor-cond--off' : 'contract-editor-cond',
        }));
      });
      return DecorationSet.create(doc, decorations);
    };
    return [new Plugin({
      key: conditionKey,
      state: {
        init: (_, state) => build(state.doc),
        apply: (transaction, old) => (transaction.docChanged || transaction.getMeta(conditionKey) ? build(transaction.doc) : old),
      },
      props: { decorations: (state) => conditionKey.getState(state) },
    })];
  },
});

/** Po zmianie opcji, nazw pól lub symulacji — przelicz etykiety bez zmiany treści. */
export const refreshContractConditions = (editor: Editor, patch: Partial<ContractConditionsStorage>) => {
  const storage = (editor.storage as unknown as Record<string, ContractConditionsStorage>).contractConditions;
  if (!storage) return;
  Object.assign(storage, patch);
  editor.view.dispatch(editor.state.tr.setMeta(conditionKey, true).setMeta('addToHistory', false));
};

export type ContractConditionTarget = { type: 'paragraph' | 'listItem' | 'contractSection'; position: number; node: PMNode };

/** Najbliższy element z warunkiem wokół kursora (akapit, punkt albo sekcja). */
export const contractConditionAtSelection = (editor: Editor): ContractConditionTarget | null => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (CONDITIONED_TYPES.has(node.type.name) && node.attrs.condition) {
      return { type: node.type.name as ContractConditionTarget['type'], position: $from.before(depth), node };
    }
  }
  const selected = (editor.state.selection as unknown as { node?: PMNode }).node;
  if (selected && CONDITIONED_TYPES.has(selected.type.name) && selected.attrs.condition) {
    return { type: selected.type.name as ContractConditionTarget['type'], position: editor.state.selection.from, node: selected };
  }
  return null;
};

/** Zaznaczenie obejmuje więcej niż jeden akapit — warunek dostanie cała sekcja. */
export const selectionSpansBlocks = (editor: Editor) => {
  const { $from, $to, empty } = editor.state.selection;
  return !empty && !$from.sameParent($to);
};

/**
 * Nadaje warunek: zaznaczonym akapitom (nowa sekcja), a bez zaznaczenia — punktowi listy albo akapitowi z kursorem.
 * Istniejący warunek w tym miejscu jest zastępowany.
 */
export const setContractCondition = (editor: Editor, condition: string) => {
  const existing = contractConditionAtSelection(editor);
  if (existing && !selectionSpansBlocks(editor)) {
    editor.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(existing.position, undefined, { ...existing.node.attrs, condition });
      return true;
    }).run();
    return;
  }
  if (selectionSpansBlocks(editor)) {
    editor.chain().focus().wrapIn('contractSection', { condition }).run();
    return;
  }
  const type = editor.isActive('listItem') ? 'listItem' : 'paragraph';
  editor.chain().focus().updateAttributes(type, { condition }).run();
};

/** Usuwa warunek z miejsca kursora; sekcja jest rozwijana (jej treść zostaje). */
export const removeContractCondition = (editor: Editor) => {
  const target = contractConditionAtSelection(editor);
  if (!target) return;
  editor.chain().focus().command(({ tr }) => {
    if (target.type === 'contractSection') tr.replaceWith(target.position, target.position + target.node.nodeSize, target.node.content);
    else tr.setNodeMarkup(target.position, undefined, { ...target.node.attrs, condition: null });
    return true;
  }).run();
};

// MARK: Miejsce na klauzule produktów

const slotLabel = (name: string, label: string | null) =>
  CONTRACT_CLAUSE_SLOTS.find((slot) => slot.name === name)?.label || label || name;

export const ContractClauseSlot = Node.create({
  name: 'contractClauseSlot',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      name: { default: '', parseHTML: (element) => element.getAttribute('data-contract-clause-slot') || '' },
      label: { default: null, parseHTML: (element) => element.getAttribute('data-clause-label') },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-contract-clause-slot]' }];
  },
  renderHTML({ node }) {
    const attributes: Record<string, string> = { 'data-contract-clause-slot': node.attrs.name };
    if (node.attrs.label) attributes['data-clause-label'] = node.attrs.label;
    return ['div', attributes, `{{${node.attrs.name}}}`];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'contract-editor-slot';
      dom.contentEditable = 'false';
      dom.setAttribute('data-contract-clause-slot', node.attrs.name);
      dom.textContent = `Klauzule produktów: ${slotLabel(node.attrs.name, node.attrs.label)}`;
      dom.title = 'Tu generator umowy wstawi klauzule produktów z tej kategorii.';
      return { dom };
    };
  },
});

// MARK: Pola {{…}} i automatyczny numer §

const PLACEHOLDER_PATTERN = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}|§\s*n\b/g;
const placeholderKey = new PluginKey('contractPlaceholders');

const placeholderDecorations = (doc: PMNode) => {
  const decorations: Decoration[] = [];
  let paragraphNumber = 0;
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(node.text))) {
      const automatic = match[0].startsWith('§');
      if (automatic) paragraphNumber += 1;
      decorations.push(Decoration.inline(position + match.index, position + match.index + match[0].length, {
        class: automatic ? 'contract-editor-field contract-editor-field--auto' : 'contract-editor-field',
        title: automatic
          ? `Numer paragrafu nadawany automatycznie — w umowie: § ${paragraphNumber}`
          : 'Pole uzupełniane danymi przy tworzeniu umowy',
      }));
    }
  });
  return DecorationSet.create(doc, decorations);
};

/**
 * Punkt listy, który zawiera tylko miejsce na klauzule, ma przed nim pusty akapit (wymóg punktu listy). Ukrywamy go,
 * żeby numer punktu stał obok znacznika klauzul, jak w PDF; po wpisaniu tekstu akapit wraca na widok.
 */
const slotLeadDecorations = (doc: PMNode, decorations: Decoration[]) => {
  doc.descendants((node, position) => {
    if (node.type.name !== 'listItem' || node.childCount < 2) return;
    const first = node.child(0);
    if (first.type.name === 'paragraph' && first.content.size === 0 && node.child(1).type.name === 'contractClauseSlot') {
      decorations.push(Decoration.node(position + 1, position + 1 + first.nodeSize, { class: 'contract-editor-slot-lead' }));
    }
  });
};

export const ContractPlaceholders = Extension.create({
  name: 'contractPlaceholders',
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const set = placeholderDecorations(doc);
      const extra: Decoration[] = [];
      slotLeadDecorations(doc, extra);
      return extra.length ? set.add(doc, extra) : set;
    };
    return [new Plugin({
      key: placeholderKey,
      state: {
        init: (_, state) => build(state.doc),
        apply: (transaction, old) => (transaction.docChanged ? build(transaction.doc) : old),
      },
      props: { decorations: (state) => placeholderKey.getState(state) },
    })];
  },
});

// MARK: Spójność stylów ze strukturą

const LIST_TYPES = new Set(['orderedList', 'bulletList']);
const POINT_STYLES: ContractStyleId[] = ['point', 'subpoint', 'subsubpoint'];
const pointStyleForLevel = (level: number): ContractStyleId => POINT_STYLES[Math.max(1, Math.min(level, 3)) - 1];
const isSectionItem = (node: PMNode | null | undefined) => node?.type.name === 'listItem' && node.attrs.contractStyle === 'heading';

/**
 * Po każdej zmianie: punkt listy ma styl zgodny z poziomem, a „Nagłówek sekcji” jest tylko na pierwszym poziomie
 * listy numerowanej. Punkty pod nagłówkiem sekcji („1. Przedmiot umowy” → 1.1, 1.2) to nadal „Punkt” — sekcja
 * nie jest poziomem punktu (jak `inferContractStyle` przy podziale na strony). Akapit w punkcie i w komórce
 * dziedziczy styl; linia nagłówka sekcji (pierwszy akapit) nie odrywa się od punktów pod nią.
 */
export const ContractStructure = Extension.create({
  name: 'contractStructure',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('contractStructure'),
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const { tr } = state;
        let changed = false;
        const set = (position: number, node: PMNode, attributes: Record<string, unknown>) => {
          const differs = Object.entries(attributes).some(([key, value]) => node.attrs[key] !== value);
          if (!differs) return;
          tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes });
          changed = true;
        };
        // pointLevel — poziom punktów bieżącej listy; listDepth — zagnieżdżenie list (nagłówek sekcji tylko na 1.).
        const visit = (node: PMNode, position: number, pointLevel: number, listDepth: number, inCell: boolean, parent: PMNode | null, index: number) => {
          if (node.type.name === 'listItem') {
            const keepHeading = isSectionItem(node) && listDepth === 1 && parent?.type.name === 'orderedList';
            set(position, node, { contractStyle: keepHeading ? 'heading' : pointStyleForLevel(pointLevel) });
          }
          if (node.type.name === 'paragraph') {
            const inItem = parent?.type.name === 'listItem';
            if (inItem || inCell) {
              const headingLine = inItem && index === 0 && isSectionItem(parent);
              set(position, node, { contractStyle: null, keepWithNext: Boolean(headingLine) });
            } else if (!node.attrs.contractStyle || POINT_STYLES.includes(node.attrs.contractStyle) || node.attrs.contractStyle === 'table') {
              set(position, node, { contractStyle: 'body', keepWithNext: false });
            } else if (node.attrs.keepWithNext) set(position, node, { keepWithNext: false });
          }
          let childPointLevel = pointLevel;
          let childListDepth = listDepth;
          if (LIST_TYPES.has(node.type.name)) {
            childListDepth = listDepth + 1;
            // Lista w nagłówku sekcji ma punkty tego samego poziomu co sekcja (1.1 to „Punkt”).
            childPointLevel = isSectionItem(parent) ? pointLevel : pointLevel + 1;
          }
          const nextInCell = inCell || node.type.name === 'tableCell' || node.type.name === 'tableHeader';
          // Styl punktu ustawiony powyżej obowiązuje dla dzieci — czytamy go z dokumentu po zmianie.
          const current = changed ? tr.doc.nodeAt(position) || node : node;
          current.forEach((child, offset, childIndex) =>
            visit(child, position + 1 + offset, childPointLevel, childListDepth, nextInCell, current, childIndex));
        };
        state.doc.forEach((child, offset, index) => visit(child, offset, 0, 0, false, state.doc, index));
        return changed ? tr : null;
      },
    })];
  },
});

// MARK: Polecenia stylów (galeria stylów, skróty)

const findAncestor = (editor: Editor, typeName: string) => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === typeName) return { node, depth, position: $from.before(depth) };
  }
  return null;
};

/** Zagnieżdżenie list i poziom punktu (punkty pod nagłówkiem sekcji mają poziom 1) w miejscu kursora. */
const listPosition = (editor: Editor) => {
  const { $from } = editor.state.selection;
  let listDepth = 0;
  let pointLevel = 0;
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    const node = $from.node(depth);
    if (LIST_TYPES.has(node.type.name)) {
      listDepth += 1;
      if (!isSectionItem($from.node(depth - 1))) pointLevel += 1;
    }
  }
  return { listDepth, pointLevel };
};

/** Styl akapitu, w którym stoi kursor (galeria stylów pokazuje go jako zaznaczony). */
export const currentContractStyle = (editor: Editor): ContractStyleId | null => {
  if (findAncestor(editor, 'tableCell') || findAncestor(editor, 'tableHeader')) return 'table';
  const item = findAncestor(editor, 'listItem');
  if (item) return (item.node.attrs.contractStyle as ContractStyleId) || pointStyleForLevel(listPosition(editor).pointLevel);
  const paragraph = findAncestor(editor, 'paragraph');
  return (paragraph?.node.attrs.contractStyle as ContractStyleId) || 'body';
};

const liftOutOfLists = (editor: Editor) => {
  let guard = 10;
  while (findAncestor(editor, 'listItem') && guard > 0) {
    guard -= 1;
    if (!editor.chain().focus().liftListItem('listItem').run()) break;
  }
};

/**
 * Nadaje styl jak w Wordzie. Tytuł/Nagłówek/Zwykły — akapit (punkt listy wraca do zwykłego akapitu, chyba że to
 * nagłówek sekcji na pierwszym poziomie listy numerowanej). Punkt/Podpunkt — lista numerowana na odpowiednim poziomie.
 */
export const applyContractStyle = (editor: Editor, style: ContractStyleId) => {
  if (findAncestor(editor, 'tableCell') || findAncestor(editor, 'tableHeader')) return;
  const item = findAncestor(editor, 'listItem');

  if (style === 'table') {
    if (!findAncestor(editor, 'table')) editor.chain().focus().insertTable({ rows: 1, cols: 2, withHeaderRow: false }).run();
    return;
  }
  if (style === 'title' || style === 'body') {
    liftOutOfLists(editor);
    editor.chain().focus().updateAttributes('paragraph', { contractStyle: style }).run();
    return;
  }
  if (style === 'heading') {
    if (item && listPosition(editor).listDepth === 1 && findAncestor(editor, 'orderedList')) {
      editor.chain().focus().updateAttributes('listItem', { contractStyle: 'heading' }).run();
      return;
    }
    liftOutOfLists(editor);
    editor.chain().focus().updateAttributes('paragraph', { contractStyle: 'heading' }).run();
    return;
  }
  // Punkt, Podpunkt, Podpunkt 2. stopnia — poziom listy numerowanej.
  const target = POINT_STYLES.indexOf(style) + 1;
  if (!item) editor.chain().focus().toggleOrderedList().run();
  else if (isSectionItem(item.node)) {
    editor.chain().focus().updateAttributes('listItem', { contractStyle: 'point' }).run();
  }
  let guard = 6;
  while (guard > 0 && listPosition(editor).pointLevel < target && editor.chain().focus().sinkListItem('listItem').run()) guard -= 1;
  while (guard > 0 && listPosition(editor).pointLevel > target && editor.chain().focus().liftListItem('listItem').run()) guard -= 1;
};

/** Skróty stylów jak w Dokumentach Google (Ctrl/Cmd+Alt+0 — Zwykły, +1 — Nagłówek sekcji, +2…4 — punkty). */
export const ContractShortcuts = Extension.create({
  name: 'contractShortcuts',
  // Przed skrótami akapitu z zestawu startowego (Ctrl/Cmd+Alt+0 — „ustaw akapit”).
  priority: 1000,
  addKeyboardShortcuts() {
    const style = (id: ContractStyleId) => () => {
      applyContractStyle(this.editor, id);
      return true;
    };
    return {
      'Mod-Alt-0': style('body'),
      'Mod-Alt-1': style('heading'),
      'Mod-Alt-2': style('point'),
      'Mod-Alt-3': style('subpoint'),
      'Mod-Alt-4': style('subsubpoint'),
    };
  },
});
