import ShortcutController from "./ShortcutController";

// Mock window for Node environment
if (typeof window === 'undefined') {
    (global as any).window = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    };
    (global as any).document = {
        createElement: jest.fn().mockReturnValue({
            style: {},
            appendChild: jest.fn(),
            addEventListener: jest.fn(),
        }),
        getElementById: jest.fn(),
    };
    (global as any).KeyboardEvent = class KeyboardEvent {
        key: string;
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        metaKey: boolean;
        constructor(type: string, init: any) {
            this.key = init.key;
            this.ctrlKey = init.ctrlKey || false;
            this.shiftKey = init.shiftKey || false;
            this.altKey = init.altKey || false;
            this.metaKey = init.metaKey || false;
        }
    };
    const localStorageMock = {
        getItem: jest.fn(),
        setItem: jest.fn(),
        clear: jest.fn(),
        removeItem: jest.fn(),
        key: jest.fn(),
        length: 0
    };
    (global as any).localStorage = localStorageMock;
    (global as any).window.localStorage = localStorageMock;
}
import App from "../App";
import { DEFAULT_SHORTCUTS, KeyCombo } from "../Data/Shortcuts";

// Mock App
jest.mock("../App", () => {
    return jest.fn().mockImplementation(() => {
        return {
            keyboardShortcutsView: {
                listContainer: document.createElement("div"),
                errorDiv: document.createElement("div"),
                resetBtn: document.createElement("button")
            }
        };
    });
});

// Mock i18n
jest.mock("../Utils/i18n", () => ({
    t: (key: string) => key
}));

describe("ShortcutController", () => {
    let app: App;
    let controller: ShortcutController;

    beforeEach(() => {
        // Reset localStorage
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: jest.fn((key) => store[key] || null),
                setItem: jest.fn((key, value) => {
                    store[key] = value.toString();
                }),
                clear: jest.fn(() => {
                    for (const key in store) delete store[key];
                }),
                removeItem: jest.fn((key) => {
                    delete store[key];
                })
            },
            writable: true
        });

        // Clear mocks
        (App as unknown as jest.Mock).mockClear();

        app = new App();
        controller = new ShortcutController(app);
    });

    test("should initialize with default shortcuts", () => {
        const defaultDef = DEFAULT_SHORTCUTS[0];
        const shortcuts = controller.getShortcuts(defaultDef.id);
        expect(shortcuts).toBeDefined();
        // Check deep equality for first default shortcut
        expect(shortcuts).toEqual(defaultDef.defaultKeys);
    });

    test("isTriggered should return true for matching key event", () => {
        // Assume default "transport.playPause" is Space
        const event = new KeyboardEvent("keydown", { key: " " });
        expect(controller.isTriggered("transport.playPause", event)).toBe(true);
    });

    test("isTriggered should respect modifiers", () => {
        // Assume "project.save" is Ctrl+S
        const eventMatch = new KeyboardEvent("keydown", { key: "s", ctrlKey: true });
        const eventNoMod = new KeyboardEvent("keydown", { key: "s", ctrlKey: false });

        expect(controller.isTriggered("project.save", eventMatch)).toBe(true);
        expect(controller.isTriggered("project.save", eventNoMod)).toBe(false);
    });

    test("updateShortcut should update definition and save to storage", () => {
        const actionId = "transport.playPause";
        const newCombo: KeyCombo = { key: "p", modifiers: ["Control"] };

        controller.updateShortcut(actionId, [newCombo]);

        const shortcuts = controller.getShortcuts(actionId);
        expect(shortcuts).toHaveLength(1);
        expect(shortcuts[0]).toEqual(newCombo);

        expect(localStorage.setItem).toHaveBeenCalledWith("dawiy_shortcuts", expect.any(String));
    });

    test("updateShortcut should throw on conflict", () => {
        const actionId1 = "transport.playPause";
        const actionId2 = "project.save";

        // Try to set playPause to Ctrl+S (which is save)
        const conflictCombo: KeyCombo = { key: "s", modifiers: ["Control"] };

        expect(() => {
            controller.updateShortcut(actionId1, [conflictCombo]);
        }).toThrow(/Conflict with/);
    });

    test("resetToDefault should restore defaults", () => {
        const actionId = "transport.playPause";
        const newCombo: KeyCombo = { key: "p" };

        controller.updateShortcut(actionId, [newCombo]);
        expect(controller.getShortcuts(actionId)[0].key).toBe("p");

        controller.resetToDefault();

        // Should back to Space
        const defaults = DEFAULT_SHORTCUTS.find(d => d.id === actionId)!;
        expect(controller.getShortcuts(actionId)).toEqual(defaults.defaultKeys);
    });

    test("loadSettings should load from localStorage on init", () => {
        // Setup storage before init
        const saved = {
            "transport.playPause": [{ key: "z" }]
        };
        (localStorage.getItem as jest.Mock).mockReturnValue(JSON.stringify(saved));

        const newController = new ShortcutController(new App());
        expect(newController.getShortcuts("transport.playPause")[0].key).toBe("z");
    });
});
