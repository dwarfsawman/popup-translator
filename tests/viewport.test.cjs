const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
const functions = ['getVisibleWindowRect', 'getViewportBounds', 'normalizeViewportMargins',
  'getDetailedPopupViewportMargins', 'clampElementToViewport', 'fitDetailedPopupToViewport',
  'ensureDetailedPopupWithinViewport'].map(name => source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');

function windowFixture(width, height) {
  const win = { innerWidth: width, innerHeight: height, scrollX: 0, scrollY: 0,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width, height },
    document: { documentElement: {}, body: {} },
    getComputedStyle: element => element.computed || { overflowX: 'visible', overflowY: 'visible' } };
  win.parent = win;
  return win;
}

function elementFixture(left, top, width, height, overflow = 'visible') {
  return { offsetWidth: width, offsetHeight: height, clientWidth: width, clientHeight: height,
    clientLeft: 0, clientTop: 0, parentElement: null,
    getRootNode: () => ({}), computed: { overflowX: overflow, overflowY: overflow },
    getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height, width, height }) };
}

function api(win) {
  const context = vm.createContext({ window: win, document: win.document,
    DEFAULT_POPUP_WIDTH: 400, DEFAULT_POPUP_HEIGHT: 300,
    POPUP_VIEWPORT_MARGIN: 8, DETAILED_POPUP_SIDE_MARGIN: 8 });
  vm.runInContext(functions, context);
  return context;
}

test('ordinary desktop and visual viewport offsets retain document coordinates', () => {
  const win = windowFixture(1600, 1000);
  win.scrollY = 200;
  win.visualViewport = { offsetLeft: 30, offsetTop: 40, width: 800, height: 600 };
  assert.deepEqual({ ...api(win).getViewportBounds() }, { left: 30, top: 240, width: 800, height: 600 });
});

test('DeX reader clips a wide iframe to its shadow DOM scroller', () => {
  const parent = windowFixture(1600, 1000);
  const child = windowFixture(13224, 1000);
  const frame = elementFixture(-1288, 0, 13224, 1000);
  const scroller = elementFixture(104, 0, 1392, 1000, 'hidden');
  frame.getRootNode = () => ({ host: scroller });
  child.parent = parent;
  child.frameElement = frame;
  assert.deepEqual({ ...api(child).getViewportBounds() }, { left: 1392, top: 0, width: 1392, height: 1000 });
});

test('nested frames intersect all ancestor viewports', () => {
  const top = windowFixture(800, 600);
  const middle = windowFixture(1200, 800);
  middle.parent = top;
  middle.frameElement = elementFixture(-100, -50, 1200, 800);
  const child = windowFixture(2000, 1000);
  child.parent = middle;
  child.frameElement = elementFixture(-200, 0, 2000, 1000);
  assert.deepEqual({ ...api(child).getViewportBounds() }, { left: 300, top: 50, width: 800, height: 600 });
});

test('scaled iframe converts parent clipping into local CSS coordinates', () => {
  const parent = windowFixture(800, 600);
  const child = windowFixture(2000, 1000);
  child.parent = parent;
  const frame = elementFixture(-100, 0, 1000, 500);
  frame.offsetWidth = frame.clientWidth = 2000;
  frame.offsetHeight = frame.clientHeight = 1000;
  child.frameElement = frame;
  assert.deepEqual({ ...api(child).getViewportBounds() }, { left: 200, top: 0, width: 1600, height: 1000 });
});

test('cross-origin access falls back to the local viewport', () => {
  const child = windowFixture(400, 700);
  Object.defineProperty(child, 'frameElement', { get() { throw new Error('SecurityError'); } });
  assert.deepEqual({ ...api(child).getViewportBounds() }, { left: 0, top: 0, width: 400, height: 700 });
});

test('right-edge placement leaves only eight pixels inside the visible boundary', () => {
  const context = api(windowFixture(1600, 1000));
  const popup = { isConnected: true, offsetLeft: 1600, offsetTop: 900,
    offsetWidth: 400, offsetHeight: 300, style: {},
    getBoundingClientRect: () => ({ width: 400, height: 300 }) };
  context.ensureDetailedPopupWithinViewport(popup);
  assert.equal(popup.style.left, '1192px');
  assert.equal(popup.style.top, '692px');
});

test('popups fit and clamp both axes even below their normal minimum size', () => {
  const win = windowFixture(150, 80);
  const context = api(win);
  const popup = { isConnected: true, offsetLeft: 140, offsetTop: 75,
    style: { width: '560px', height: '420px' },
    get offsetWidth() { return parseFloat(this.style.width); },
    get offsetHeight() { return parseFloat(this.style.height); },
    getBoundingClientRect() { return { width: this.offsetWidth, height: this.offsetHeight }; } };
  context.ensureDetailedPopupWithinViewport(popup);
  assert.equal(popup.style.width, '150px');
  assert.equal(popup.style.height, '64px');
  assert.equal(popup.style.left, '0px');
  assert.equal(popup.style.top, '8px');
  assert.equal(popup.style.minWidth, '150px');
  assert.equal(popup.style.maxHeight, '64px');
});
