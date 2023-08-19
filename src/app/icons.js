import { dom, library } from '@fortawesome/fontawesome-svg-core';
import { faBold } from '@fortawesome/free-solid-svg-icons/faBold';
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
import { faClipboard } from '@fortawesome/free-solid-svg-icons/faClipboard';
import { faCode } from '@fortawesome/free-solid-svg-icons/faCode';
import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy';
import { faDatabase } from '@fortawesome/free-solid-svg-icons/faDatabase';
import { faExclamationCircle } from '@fortawesome/free-solid-svg-icons/faExclamationCircle';
import { faItalic } from '@fortawesome/free-solid-svg-icons/faItalic';
import { faListOl } from '@fortawesome/free-solid-svg-icons/faListOl';
import { faListUl } from '@fortawesome/free-solid-svg-icons/faListUl';
import { faStrikethrough } from '@fortawesome/free-solid-svg-icons/faStrikethrough';
import { faTasks } from '@fortawesome/free-solid-svg-icons/faTasks';
import { faTerminal } from '@fortawesome/free-solid-svg-icons/faTerminal';
import { faMoon } from '@fortawesome/free-solid-svg-icons/faMoon';
import { faCog } from '@fortawesome/free-solid-svg-icons/faCog';
import { faSave } from '@fortawesome/free-solid-svg-icons/faSave';
import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons/faQuestionCircle';

library.add(
    faBold,
    faItalic,
    faStrikethrough,
    faListUl,
    faListOl,
    faTasks,
    faCode,
    faTerminal,
    faDatabase,
    faExclamationCircle,
    faCopy,
    faCheck,
    faClipboard,
    faMoon,
    faCog,
    faSave,
    faQuestionCircle
);

dom.watch();
