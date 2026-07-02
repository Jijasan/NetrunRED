const ALLOWED_NODE_TYPES = ['Пароль', 'Файл', 'Управляющий Узел', 'Программа'];
const HELIOS_NODE_TYPES = {
  'Public Relay Gateway': 'Пароль',
  'Identity Broker': 'Пароль',
  'Traffic Exchange': 'Управляющий Узел',
  'Diagnostic Mirror': 'Файл',
  'Watchdog ICE': 'Программа',
  'Building Security Bus': 'Управляющий Узел',
  'Encrypted Data Exchange': 'Пароль',
  'Archive Hound ICE': 'Программа',
  'Helios Core Junction': 'Управляющий Узел',
  'Executive Payroll Ledger': 'Файл',
  'Cold Backup Index': 'Файл',
  'Project SUNVAULT': 'Файл',
  'Perimeter Drone Control': 'Управляющий Узел',
  'Root Certificate Authority': 'Файл'
};
const icePresets = {
  'Аспид': { perception: 4, speed: 6, attack: 2, defense: 2, rez: 15, effect: 'Уничтожает одну случайную Программу из Кибердеки Нетраннера.' },
  'Великан': { perception: 2, speed: 2, attack: 8, defense: 4, rez: 25, effect: 'Наносит 3d6 урона мозгу и выбрасывает Нетраннера из текущего «лифта».' },
  'Адская Гончая': { perception: 6, speed: 6, attack: 6, defense: 2, rez: 20, effect: 'Наносит 2d6 урона мозгу; Кибердека и одежда загораются, нанося 2 урона в конце Хода до тушения Мясным Действием.' }
};
const programCatalog = [
  { catalogId: 'eraser', name: 'Стиратель', class: 'Усиление', category: 'Усиления', cost: 20, availability: 'Повседневная', attack: 0, defense: 0, rez: 7, effect: '+2 ко всем проверкам «Плащ», пока Программа активна.' },
  { catalogId: 'see-ya', name: 'Найдёмся!', class: 'Усиление', category: 'Усиления', cost: 20, availability: 'Повседневная', attack: 0, defense: 0, rez: 7, effect: '+2 ко всем проверкам «Первопроходец», пока Программа активна.' },
  { catalogId: 'speedy-gonzalvez', name: 'Быстрый Гонзалес', class: 'Усиление', category: 'Усиления', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 7, effect: '+2 к Скорости, пока Программа активна.' },
  { catalogId: 'worm', name: 'Червь', class: 'Усиление', category: 'Усиления', cost: 50, availability: 'Дорогая', attack: 0, defense: 0, rez: 7, effect: '+2 ко всем проверкам «Бэкдор», пока Программа активна.' },
  { catalogId: 'armor', name: 'Доспехи', class: 'Защитная', category: 'Защитные', cost: 50, availability: 'Дорогая', attack: 0, defense: 0, rez: 7, effect: 'Снижает весь получаемый урон мозгу на 4, пока активна. Одновременно может работать только одна копия; каждая копия используется один раз за забег.' },
  { catalogId: 'flak', name: 'Зенитка', class: 'Защитная', category: 'Защитные', cost: 50, availability: 'Дорогая', attack: 0, defense: 0, rez: 7, effect: 'Снижает АТК всех вражеских атакующих Программ, не являющихся Чёрным ЛЬДОМ, до 0. Одновременно может работать только одна копия; каждая копия используется один раз за забег.' },
  { catalogId: 'shield', name: 'Щит', class: 'Защитная', category: 'Защитные', cost: 20, availability: 'Повседневная', attack: 0, defense: 0, rez: 7, effect: 'Блокирует первый успешный урон мозгу от Программы, не являющейся Чёрным ЛЬДОМ, затем деактивируется. Одновременно работает одна копия; каждая копия используется один раз за забег.' },
  { catalogId: 'banhammer', name: 'Банхаммер', class: 'Атакующая', category: 'Атакующие против программ', target: 'Программы', cost: 50, availability: 'Дорогая', attack: 1, defense: 0, rez: 0, effect: 'Наносит 3d6 урона REZ обычной Программе или 2d6 Чёрному ЛЬДУ.' },
  { catalogId: 'sword', name: 'Меч', class: 'Атакующая', category: 'Атакующие против программ', target: 'Программы', cost: 50, availability: 'Дорогая', attack: 1, defense: 0, rez: 0, effect: 'Наносит 3d6 урона REZ Чёрному ЛЬДУ или 2d6 обычной Программе.' },
  { catalogId: 'deckkrash', name: 'Деколом', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 0, effect: 'Принудительно и небезопасно отключает вражеского Нетраннера; тот получает эффекты всего встреченного активного Чёрного ЛЬДА.' },
  { catalogId: 'hellbolt', name: 'Адская стрела', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 2, defense: 0, rez: 0, effect: 'Наносит 2d6 урона мозгу. Неизолированная кибердека и одежда загораются и наносят 2 урона в конце каждого Хода до тушения Мясным Действием; эффект не складывается.' },
  { catalogId: 'nervescrub', name: 'Нервотрёп', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 0, effect: 'На час снижает INT, REF и DEX цели на 1d6, минимум до 1; постоянных последствий нет.' },
  { catalogId: 'poison-flatline', name: 'Смертельный Яд', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 0, defense: 0, rez: 0, effect: 'Уничтожает случайную обычную Программу в кибердеке вражеского Нетраннера.' },
  { catalogId: 'superglue', name: 'Суперклей', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 100, availability: 'Премиальная', attack: 2, defense: 0, rez: 0, effect: 'На 1d6 Раундов запрещает цели двигаться глубже или безопасно отключаться; небезопасное отключение возможно. Каждая копия используется один раз за забег.' },
  { catalogId: 'vrizzbolt', name: 'Спираль', class: 'Атакующая', category: 'Атакующие против Нетраннеров', target: 'Нетраннеры', cost: 50, availability: 'Дорогая', attack: 1, defense: 0, rez: 0, effect: 'Наносит 1d6 урона мозгу и уменьшает Сетевые Действия цели на следующем Ходу на 1, минимум до 2.' },
  { catalogId: 'asp-ice', name: 'Аспид', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 100, availability: 'Премиум', perception: 4, speed: 6, attack: 2, defense: 2, rez: 15, effect: 'Уничтожает одну случайную Программу из Кибердеки вражеского Нетраннера.' },
  { catalogId: 'giant-ice', name: 'Великан', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 1000, availability: 'Очень дорогое', perception: 2, speed: 2, attack: 8, defense: 4, rez: 25, damageDice: 3, effect: 'Наносит 3d6 урона мозгу и выбрасывает Нетраннера из текущего «забега». Нетраннер испытывает эффекты всего активированного Чёрного ЛЬДА, с которым столкнулся в Архитектуре, кроме Великана.' },
  { catalogId: 'hellhound-ice', name: 'Адская Гончая', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 500, availability: 'Дорогое', perception: 6, speed: 6, attack: 6, defense: 2, rez: 20, damageDice: 2, effect: 'Наносит 2d6 урона мозгу. Кибердека без термоизоляции загорается вместе с одеждой Нетраннера; в конце каждого своего Хода Нетраннер получает 2 урона, пока не потратит Мясное Действие, чтобы потушить себя. Эффект не складывается.' },
  { catalogId: 'kraken-ice', name: 'Кракен', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 1000, availability: 'Очень дорогое', perception: 6, speed: 2, attack: 8, defense: 4, rez: 30, damageDice: 3, effect: 'Наносит 3d6 урона мозгу. В течение двух Ходов Нетраннер не может двигаться вглубь Архитектуры и безопасно отключаться; небезопасное отключение всё ещё возможно.' },
  { catalogId: 'lich-ice', name: 'Лич', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 500, availability: 'Дорогое', perception: 8, speed: 2, attack: 6, defense: 2, rez: 25, effect: 'ИНТ, РЕА и ЛВК вражеского Нетраннера в течение следующего часа снижаются на 1d6, минимум до 1. Воздействие в основном психосоматическое и спустя час проходит.' },
  { catalogId: 'raven-ice', name: 'Ворон', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 50, availability: 'Ценное', perception: 6, speed: 4, attack: 4, defense: 2, rez: 15, damageDice: 1, effect: 'Отключает одну случайную Защитную Программу из активированных Программ вражеского Нетраннера, затем наносит 1d6 урона мозгу Раннеру.' },
  { catalogId: 'scorpion-ice', name: 'Скорпион', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 100, availability: 'Премиум', perception: 2, speed: 6, attack: 2, defense: 2, rez: 15, effect: 'СКО вражеского Нетраннера в течение часа снижается на 1d6, минимум до 1. Воздействие психологическое и спустя час проходит.' },
  { catalogId: 'skunk-ice', name: 'Скунс', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 500, availability: 'Дорогое', perception: 2, speed: 4, attack: 4, defense: 2, rez: 10, effect: 'Вражеский Раннер получает −2 ко всем проверкам «Ускользнуть», пока эта Программа активирована. Каждый Скунс воздействует только на одного Нетраннера, но эффекты нескольких Скунсов складываются.' },
  { catalogId: 'wisp-ice', name: 'Висп', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Людей', target: 'Нетраннеры', slots: 2, cost: 50, availability: 'Ценное', perception: 4, speed: 4, attack: 4, defense: 2, rez: 15, damageDice: 1, effect: 'Наносит 1d6 урона мозгу Нетраннера и уменьшает количество Сетевых Действий, которые Нетраннер может сделать в следующий Ход, на 1, минимум до 2.' },
  { catalogId: 'dragon-ice', name: 'Дракон', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Программ', target: 'Программы', slots: 2, cost: 1000, availability: 'Очень дорогая', perception: 6, speed: 4, attack: 6, defense: 6, rez: 30, damageDice: 6, effect: 'Наносит 6d6 урона Программе. Если урона хватает для деактивации, Программа уничтожается.' },
  { catalogId: 'killer-ice', name: 'Убийца', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Программ', target: 'Программы', slots: 2, cost: 500, availability: 'Дорогая', perception: 4, speed: 8, attack: 6, defense: 2, rez: 20, damageDice: 4, effect: 'Наносит 4d6 урона Программе. Если урона хватает для деактивации, Программа уничтожается.' },
  { catalogId: 'sabertooth-ice', name: 'Саблезубый', class: 'Чёрный ЛЁД', category: 'Чёрный ЛЁД против Программ', target: 'Программы', slots: 2, cost: 1000, availability: 'Очень дорогая', perception: 8, speed: 6, attack: 6, defense: 2, rez: 25, damageDice: 6, effect: 'Наносит 6d6 урона Программе. Если урона хватает для деактивации, Программа уничтожается.' }
];

module.exports = { ALLOWED_NODE_TYPES, HELIOS_NODE_TYPES, icePresets, programCatalog };
