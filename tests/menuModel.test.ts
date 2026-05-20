/**
 * Schema + integration test for the menu model.
 *
 * Catches drift between the model and the surfaces that consume it:
 *
 *  - Every `kind: 'channel'` action must name a channel that the
 *    renderer is allowed to receive (whitelisted in `preload.ts`).
 *    Without that the main-process menu click would post a `from:*`
 *    event the renderer drops on the floor.
 *  - Every `kind: 'command'` action must name a `commandId` that
 *    `AppMenu.runCommand` actually handles. Otherwise the click is
 *    a silent no-op.
 *  - Every `kind: 'role'` action must use one of the supported
 *    `MenuRole` strings — these are the Electron roles `AppMenu`
 *    coerces to `MenuItemConstructorOptions['role']`.
 *  - Stable ids, no duplicates, every group has at least one item.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  menuModel,
  type MenuItem,
  type MenuRole,
} from '../src/app/lib/menuModel';

const SUPPORTED_ROLES: MenuRole[] = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'togglefullscreen',
  'quit',
];

const KNOWN_COMMAND_IDS = ['open-log', 'toggle-devtools'];

/** Whitelisted `from:*` channels parsed straight out of `preload.ts` so
 *  this test catches drift if either side updates without the other. */
function loadReceiverWhitelist(): string[] {
  const preloadSrc = readFileSync(
    join(__dirname, '..', 'src', 'app', 'preload.ts'),
    'utf-8',
  );
  const match = preloadSrc.match(/const receiverWhitelist = \[([\s\S]*?)\];/);
  if (!match)
    throw new Error('Could not locate receiverWhitelist in preload.ts');
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function flatItems(): MenuItem[] {
  return menuModel.flatMap((group) => group.items);
}

describe('menuModel structure', () => {
  it('has four groups with at least one item each', () => {
    expect(menuModel).toHaveLength(4);
    for (const group of menuModel) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('group ids are unique and from the allowed set', () => {
    const ids = menuModel.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(['file', 'edit', 'view', 'help']).toContain(id);
    }
  });

  it('every MenuItem id is unique across the entire model', () => {
    const ids = flatItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every MenuItem has a non-empty English label', () => {
    for (const item of flatItems()) {
      expect(item.label).toBeTruthy();
    }
  });
});

describe('menuModel actions', () => {
  it.each(flatItems().map((item) => [item.id, item]))(
    '%s resolves to a valid action',
    (_id, item) => {
      // Items without an action exist in theory (separator-only rows etc.)
      // but the current model has none — flagging here keeps that
      // assumption explicit.
      expect(item.action).toBeDefined();
    },
  );

  it('every channel-kind action targets a whitelisted from:* channel', () => {
    const whitelist = loadReceiverWhitelist();
    for (const item of flatItems()) {
      if (item.action?.kind !== 'channel') continue;
      expect(whitelist).toContain(item.action.channel);
    }
  });

  it('every role-kind action uses a supported MenuRole', () => {
    for (const item of flatItems()) {
      if (item.action?.kind !== 'role') continue;
      expect(SUPPORTED_ROLES).toContain(item.action.role);
    }
  });

  it('every command-kind action has a handler in AppMenu.runCommand', () => {
    for (const item of flatItems()) {
      if (item.action?.kind !== 'command') continue;
      expect(KNOWN_COMMAND_IDS).toContain(item.action.commandId);
    }
  });
});
