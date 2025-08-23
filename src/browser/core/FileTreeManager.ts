import { ContextBridgeAPI } from '../interfaces/Bridge';
import { dom } from '../dom';
import Swal from 'sweetalert2';

/**
 * Handle the file explorer tree.
 */
export class FileTreeManager {
  /** Root path for the current file tree */
  public treeRoot: string | null = null;

  /** Map of directory <ul> elements */
  public directoryMap: Map<string, HTMLElement> = new Map();

  /** Flag to track file tree listener registration */
  public fileTreeListenerRegistered = false;

  /** Flag to indicate a new root folder is being opened */
  public openingFolder = false;

  /** reference to the active context menu */
  private contextMenu: HTMLDivElement | null = null;

  /**
   * Create a new file tree manager instance.
   *
   * @param bridge - the executuon bridge
   * @param openFileFromPath - callback to open a file
   */
  constructor(
    private bridge: ContextBridgeAPI,
    private openFileFromPath: (path: string) => void,
  ) {}

  /**
   * Build the file explorer tree.
   *
   * @param tree - recursive tree
   * @param parentPath - the parent path
   * @returns
   */
  public buildFileTree(tree: any[], parentPath: string) {
    if (!dom.filetree || !Array.isArray(tree)) {
      return;
    }

    if (!this.fileTreeListenerRegistered) {
      dom.filetree.addEventListener('click', this.handleFileTreeClick);
      dom.filetree.addEventListener(
        'contextmenu',
        this.handleFileTreeContextMenu,
      );
      this.fileTreeListenerRegistered = true;
    }

    let parent: HTMLElement;
    if (!this.treeRoot || parentPath === this.treeRoot) {
      dom.filetree.innerHTML = '';
      parent = dom.filetree;
      this.directoryMap.clear();
      this.directoryMap.set(parentPath, dom.filetree);
    } else {
      const ul = this.directoryMap.get(parentPath);
      if (!ul) {
        return;
      }
      ul.innerHTML = '';
      ul.dataset.loaded = 'true';
      parent = ul;

      const li = ul.parentElement as HTMLElement | null;
      if (tree.length === 0 && li) {
        li.dataset.hasChildren = 'false';
        const chevron = li.querySelector(
          ':scope > span.file-name > span:first-child',
        );
        chevron?.firstElementChild?.classList.add('invisible');
      }
    }

    const build = (nodes: any[], parentEl: HTMLElement) => {
      const validNodes = nodes.filter((n) => {
        if (
          n &&
          (n.type === 'directory' || n.type === 'file') &&
          typeof n.name == 'string' &&
          typeof n.path === 'string'
        ) {
          return n;
        }
      });

      const sorted = [...validNodes].sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base',
          });
        }
        return a.type === 'directory' ? -1 : 1;
      });

      const fragment = document.createDocumentFragment();
      sorted.forEach((node) => {
        const li = document.createElement('li');
        li.classList.add('ft-node', node.type);

        const span = document.createElement('span');
        span.classList.add('file-name');

        const chevron = document.createElement('span');
        chevron.classList.add('me-1');
        chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
        if (node.type !== 'directory' || !node.hasChildren) {
          chevron.firstElementChild?.classList.add('invisible');
        }
        chevron.style.display = 'inline-block';
        chevron.style.fontSize = '0.7em';
        span.appendChild(chevron);

        const icon = document.createElement('span');
        icon.classList.add('me-1');
        icon.innerHTML =
          node.type === 'directory'
            ? '<i class="fa fa-folder"></i>'
            : '<i class="fa fa-file"></i>';
        span.appendChild(icon);
        span.append(node.name);
        li.appendChild(span);

        if (node.type === 'directory') {
          li.dataset.path = node.path;
          li.dataset.hasChildren = node.hasChildren ? 'true' : 'false';
          const ul = document.createElement('ul');
          ul.classList.add('list-unstyled', 'ps-3');
          ul.style.display = 'none';
          li.appendChild(ul);
          this.directoryMap.set(node.path, ul);
        } else {
          li.classList.add('file');
          li.dataset.path = node.path;
        }
        fragment.appendChild(li);
      });
      parentEl.appendChild(fragment);
    };

    build(tree, parent);
  }

  /**
   * Handle click events on file tree items.
   *
   * @param e - the clicke event
   * @returns
   */
  private handleFileTreeClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const span = target.closest('span.file-name');
    if (!span) {
      return;
    }

    const li = span.parentElement as HTMLElement;
    if (!li) {
      return;
    }

    if (li.classList.contains('directory')) {
      const ul = li.querySelector(':scope > ul') as HTMLElement | null;
      if (!ul) {
        return;
      }

      const chevron = span.firstElementChild as HTMLElement;
      const icon = chevron?.nextElementSibling as HTMLElement;
      const isOpen = ul.style.display !== 'none';

      if (isOpen) {
        ul.style.display = 'none';
        chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
        icon.innerHTML = '<i class="fa fa-folder"></i>';
      } else {
        ul.style.display = '';
        chevron.innerHTML = '<i class="fa fa-chevron-down"></i>';
        icon.innerHTML = '<i class="fa fa-folder-open"></i>';
        if (
          !ul.dataset.loaded &&
          li.dataset.hasChildren === 'true' &&
          li.dataset.path
        ) {
          this.bridge.send('to:file:openpath', { path: li.dataset.path });
        }
      }
    } else if (li.classList.contains('file') && li.dataset.path) {
      e.preventDefault();
      this.openFileFromPath(li.dataset.path);
    }
  };

  /** hide any active context menu */
  private hideContextMenu = () => {
    this.contextMenu?.remove();
    this.contextMenu = null;
  };

  /** show a context menu at a given position */
  private showContextMenu(
    items: { label: string; action: () => void; divider?: boolean }[],
    x: number,
    y: number,
  ) {
    this.hideContextMenu();
    const menu = document.createElement('div');
    menu.classList.add('dropdown-menu', 'show', 'shadow', 'rounded-0');
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    items.forEach((item) => {
      if (item.divider) {
        const div = document.createElement('div');
        div.classList.add('dropdown-divider');
        menu.appendChild(div);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('dropdown-item', 'extra-small');
        btn.textContent = item.label;
        btn.addEventListener('click', () => {
          item.action();
          this.hideContextMenu();
        });
        menu.appendChild(btn);
      }
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;

    setTimeout(() =>
      document.addEventListener('click', this.hideContextMenu, { once: true }),
    );
  }

  /** handle right click events */
  private handleFileTreeContextMenu = async (e: MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const li = target.closest('li.ft-node') as HTMLElement | null;

    const items: { label: string; action: () => void; divider?: boolean }[] =
      [];

    if (!li) {
      if (this.treeRoot) {
        items.push(
          {
            label: 'New File',
            action: async () => {
              const result = await Swal.fire({
                title: 'New file name',
                input: 'text',
                inputPlaceholder: 'Untitled.md',
                showCancelButton: true,
              });
              if (result.isConfirmed && result.value) {
                this.bridge.send('to:file:create', {
                  parent: this.treeRoot,
                  name: result.value,
                });
              }
            },
          },
          {
            label: 'New Folder',
            action: async () => {
              const result = await Swal.fire({
                title: 'New folder name',
                input: 'text',
                showCancelButton: true,
              });
              if (result.isConfirmed && result.value) {
                this.bridge.send('to:folder:create', {
                  parent: this.treeRoot,
                  name: result.value,
                });
              }
            },
          },
          { divider: true, label: '', action: () => {} },
          {
            label: 'Collapse Explorer',
            action: () => {
              document
                .querySelector<HTMLButtonElement>('#sidebar-toggle')
                ?.click();
            },
          },
          {
            label: 'Open Settings',
            action: () => {
              (
                document.querySelector(
                  '[data-bs-target="#app-settings"]',
                ) as HTMLElement | null
              )?.click();
            },
          },
        );
      }
    } else if (li.classList.contains('file') && li.dataset.path) {
      const path = li.dataset.path;
      items.push(
        {
          label: 'Open File',
          action: () => {
            this.openFileFromPath(path);
          },
        },
        {
          label: 'Rename File...',
          action: async () => {
            const result = await Swal.fire({
              title: 'Rename file',
              input: 'text',
              inputValue: path.split(/[/\\]/).pop(),
              showCancelButton: true,
            });
            if (result.isConfirmed && result.value) {
              this.bridge.send('to:file:rename', { path, name: result.value });
            }
          },
        },
        {
          label: 'Delete File...',
          action: async () => {
            const confirm = await Swal.fire({
              title: 'Delete file?',
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: 'Delete',
            });
            if (confirm.isConfirmed) {
              this.bridge.send('to:file:delete', { path });
            }
          },
        },
        {
          label: 'Show Properties...',
          action: () => {
            this.bridge.send('to:file:properties', { path });
          },
        },
        { divider: true, label: '', action: () => {} },
        {
          label: 'Collapse Explorer',
          action: () => {
            document
              .querySelector<HTMLButtonElement>('#sidebar-toggle')
              ?.click();
          },
        },
        {
          label: 'Open Settings...',
          action: () => {
            (
              document.querySelector(
                '[data-bs-target="#app-settings"]',
              ) as HTMLElement | null
            )?.click();
          },
        },
      );
    } else if (li.classList.contains('directory') && li.dataset.path) {
      const path = li.dataset.path;
      items.push(
        {
          label: 'Open Folder',
          action: () => {
            const span = li.querySelector(':scope > span.file-name');
            const ul = li.querySelector(':scope > ul') as HTMLElement | null;
            if (span && ul && ul.style.display === 'none') {
              span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
          },
        },
        {
          label: 'Rename Folder...',
          action: async () => {
            const result = await Swal.fire({
              title: 'Rename folder',
              input: 'text',
              inputValue: path.split(/[/\\]/).pop(),
              showCancelButton: true,
            });
            if (result.isConfirmed && result.value) {
              this.bridge.send('to:file:rename', { path, name: result.value });
            }
          },
        },
        {
          label: 'Delete Folder...',
          action: async () => {
            const confirm = await Swal.fire({
              title: 'Delete folder?',
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: 'Delete',
            });
            if (confirm.isConfirmed) {
              this.bridge.send('to:file:delete', { path });
            }
          },
        },
        {
          label: 'Show Properties...',
          action: () => {
            this.bridge.send('to:file:properties', { path });
          },
        },
        { divider: true, label: '', action: () => {} },
        {
          label: 'Collapse Explorer',
          action: () => {
            document
              .querySelector<HTMLButtonElement>('#sidebar-toggle')
              ?.click();
          },
        },
        {
          label: 'Open Settings...',
          action: () => {
            (
              document.querySelector(
                '[data-bs-target="#app-settings"]',
              ) as HTMLElement | null
            )?.click();
          },
        },
      );
    }

    if (items.length > 0) {
      this.showContextMenu(items, e.clientX, e.clientY);
    }
  };

  /**
   * Add a file to the file tree.
   *
   * @param path - the path of the file to add
   * @returns
   */
  public addFileToTree(path: string) {
    if (!dom.filetree || !this.treeRoot) {
      return;
    }

    if (!path.startsWith(this.treeRoot)) {
      return;
    }

    const sep = this.treeRoot.includes('\\') ? '\\' : '/';
    const segments = path.split(/[/\\]/);
    const rootSegments = this.treeRoot.split(/[/\\]/);
    const rel = segments.slice(rootSegments.length);

    let currentPath = this.treeRoot;
    let parentUl = this.directoryMap.get(currentPath) || dom.filetree;
    if (!parentUl) {
      return;
    }

    for (let i = 0; i < rel.length - 1; i++) {
      const dir = rel[i];
      currentPath += sep + dir;

      const ul = this.directoryMap.get(currentPath);
      if (!ul) {
        return;
      }

      if (ul.style.display === 'none') {
        const span = ul.previousElementSibling as HTMLElement;
        span?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }

      parentUl = ul;
    }

    const fileName = rel[rel.length - 1];
    const existing = Array.from(
      parentUl.querySelectorAll(':scope > li.file'),
    ).find((el) => (el as HTMLElement).dataset.path === path);
    if (existing) {
      return;
    }

    const li = document.createElement('li');
    li.classList.add('ft-node', 'file');
    li.dataset.path = path;

    const span = document.createElement('span');
    span.classList.add('file-name');

    const chevron = document.createElement('span');
    chevron.classList.add('me-1');
    chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
    chevron.firstElementChild?.classList.add('invisible');
    chevron.style.display = 'inline-block';
    chevron.style.fontSize = '0.7em';
    span.appendChild(chevron);

    const icon = document.createElement('span');
    icon.classList.add('me-1');
    icon.innerHTML = '<i class="fa fa-file"></i>';
    span.appendChild(icon);
    span.append(fileName);

    li.appendChild(span);

    const fileNodes = Array.from(
      parentUl.querySelectorAll(':scope > li.file'),
    ) as HTMLElement[];
    const before = fileNodes.find((el) => {
      const nameEl = el.querySelector(':scope > span.file-name');
      const name = nameEl?.textContent?.trim() || '';
      return (
        fileName.localeCompare(name, undefined, { sensitivity: 'base' }) < 0
      );
    });
    if (before) {
      parentUl.insertBefore(li, before);
    } else {
      parentUl.appendChild(li);
    }
  }
}
