import type { CatalogSet } from '../../types';
import * as cloudCeiling from './cloudCeiling';
import * as dementor from './dementor';
import * as dobby from './dobby';
import * as hatLantern from './hatLantern';
import * as mandrakes from './mandrakes';
import * as owlCage from './owlCage';
import * as owlPost from './owlPost';
import * as prophetWall from './prophetWall';
import * as signpost from './signpost';
import * as wizardFrame from './wizardFrame';
import * as xmasTree from './xmasTree';

/** Модули набора в порядке раздела 4 спецификации (он же — порядок карточек в библиотеке). */
const modules = [
  cloudCeiling,
  dementor,
  prophetWall,
  owlPost,
  signpost,
  hatLantern,
  wizardFrame,
  mandrakes,
  dobby,
  owlCage,
  xmasTree,
];

export const hpSet: CatalogSet = {
  id: 'harry-potter',
  title: 'Гарри Поттер',
  order: 50,
  items: modules.map((m) => m.item),
  painters: Object.assign({}, ...modules.map((m) => m.painters)),
};
