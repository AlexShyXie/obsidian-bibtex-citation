/**
 * main.js 加载冒烟测试：stub obsidian 模块，验证产物顶层加载不炸
 * （重点：encoding stub、Node 内置 require、worker 通道）。
 */
const Module = require('module');
const fs = require('fs');

const stubObsidian = {
  Plugin: class PluginStub {
    registerEvent() {}
    addCommand() {}
    addRibbonIcon() {}
    addSettingTab() {}
    registerEditorSuggest() {}
    registerView() {}
    register() {}
  },
  PluginSettingTab: class PluginSettingTabStub {},
  Modal: class ModalStub {},
  Notice: class NoticeStub {},
  Setting: class SettingStub {},
  Events: class EventsStub {
    on() {
      return {};
    }
    trigger() {}
  },
  ItemView: class ItemViewStub {},
  WorkspaceLeaf: class WorkspaceLeafStub {},
  EditorSuggest: class EditorSuggestStub {},
  SuggestModal: class SuggestModalStub {},
  FuzzySuggestModal: class FuzzySuggestModalStub {},
  MarkdownView: class MarkdownViewStub {},
  MarkdownSourceView: class MarkdownSourceViewStub {},
  FileSystemAdapter: class FileSystemAdapterStub {
    static readLocalFile() {
      return Promise.resolve('');
    }
  },
  TFile: class TFileStub {},
  normalizePath: (p) => p,
  renderMatches: () => {},
  SearchMatchPart: {},
  AbstractInputSuggest: class AbstractInputSuggestStub {},
  AbstractTextComponent: class AbstractTextComponentStub {},
  DropdownComponent: class DropdownComponentStub {},
  ButtonComponent: class ButtonComponentStub {},
  ToggleComponent: class ToggleComponentStub {},
};

const code = fs.readFileSync('main.js', 'utf8');
const wrapper = new Function('require', 'module', 'exports', code);
const fakeModule = { exports: {} };
const originalFs = (() => {
  try {
    return require('original-fs');
  } catch {
    return fs; // 冒烟环境无 Electron original-fs，等价替换
  }
})();
try {
  wrapper(
    (name) =>
      name === 'obsidian'
        ? stubObsidian
        : name === 'original-fs'
          ? originalFs
          : require(name),
    fakeModule,
    fakeModule.exports,
  );
} catch (error) {
  console.error('冒烟失败:', error.message);
  process.exit(1);
}

const key = fakeModule.exports && fakeModule.exports.default ? 'default' : Object.keys(fakeModule.exports)[0];
console.log('main.js 加载冒烟 OK；exports:', typeof key === 'string' ? key : typeof key);
