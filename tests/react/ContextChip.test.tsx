/**
 * ContextChipsRow (AI Assistant P6) unit tests.
 *
 * Stateless presentational component — drives it directly with a
 * chip list + a triple of remove handlers and asserts each chip
 * routes its × click to the right handler.
 */

import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { ContextChipsRow } from '../../src/browser/react/components/assistant/ContextChip';
import type { AssistantContextChip } from '../../src/browser/core/AssistantManager';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

describe('<ContextChipsRow>', () => {
  it('renders nothing when the chip list is empty', () => {
    render(
      <ContextChipsRow
        chips={[]}
        onRemoveActive={jest.fn()}
        onRemoveSelection={jest.fn()}
        onRemoveMention={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('context-chips')).toBeNull();
  });

  it('renders one chip per AssistantContextChip with the label as text', () => {
    const chips: AssistantContextChip[] = [
      { kind: 'active', path: '/w/a.md', label: 'a.md (active)' },
      { kind: 'selection', path: '/w/a.md', label: 'selection L1–L3' },
      { kind: 'mention', path: '/w/b.md', label: 'b.md' },
    ];
    render(
      <ContextChipsRow
        chips={chips}
        onRemoveActive={jest.fn()}
        onRemoveSelection={jest.fn()}
        onRemoveMention={jest.fn()}
      />,
    );
    expect(screen.getByText('a.md (active)')).toBeInTheDocument();
    expect(screen.getByText('selection L1–L3')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
  });

  it('× on an active chip fires onRemoveActive (which flips the toggle off)', () => {
    const onRemoveActive = jest.fn();
    const onRemoveSelection = jest.fn();
    const onRemoveMention = jest.fn();
    render(
      <ContextChipsRow
        chips={[{ kind: 'active', path: '/w/a.md', label: 'a.md (active)' }]}
        onRemoveActive={onRemoveActive}
        onRemoveSelection={onRemoveSelection}
        onRemoveMention={onRemoveMention}
      />,
    );
    const chip = screen.getByTestId('context-chip-active');
    fireEvent.click(chip.querySelector('button')!);
    expect(onRemoveActive).toHaveBeenCalledTimes(1);
    expect(onRemoveSelection).not.toHaveBeenCalled();
    expect(onRemoveMention).not.toHaveBeenCalled();
  });

  it('× on a selection chip fires onRemoveSelection', () => {
    const onRemoveSelection = jest.fn();
    render(
      <ContextChipsRow
        chips={[{ kind: 'selection', path: null, label: 'selection L1–L1' }]}
        onRemoveActive={jest.fn()}
        onRemoveSelection={onRemoveSelection}
        onRemoveMention={jest.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId('context-chip-selection').querySelector('button')!,
    );
    expect(onRemoveSelection).toHaveBeenCalledTimes(1);
  });

  it('× on a mention chip fires onRemoveMention with the chip path', () => {
    const onRemoveMention = jest.fn();
    render(
      <ContextChipsRow
        chips={[{ kind: 'mention', path: '/w/notes.md', label: 'notes.md' }]}
        onRemoveActive={jest.fn()}
        onRemoveSelection={jest.fn()}
        onRemoveMention={onRemoveMention}
      />,
    );
    fireEvent.click(
      screen.getByTestId('context-chip-mention').querySelector('button')!,
    );
    expect(onRemoveMention).toHaveBeenCalledWith('/w/notes.md');
  });
});
