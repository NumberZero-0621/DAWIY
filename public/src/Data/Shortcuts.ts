export type KeyCombo = {
    key: string;
    modifiers?: ("Control" | "Shift" | "Alt" | "Meta")[];
};

export interface ShortcutDefinition {
    id: string;
    description: string; // i18n key
    defaultKeys: KeyCombo[];
    category: "global" | "editor" | "transport" | "tools";
    readonly?: boolean;
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
    // Transport
    {
        id: "transport.playPause",
        description: "shortcut.play_pause",
        defaultKeys: [{ key: " " }], // Space
        category: "transport"
    },
    {
        id: "transport.record",
        description: "shortcut.record",
        defaultKeys: [{ key: "*" }], // Numpad * or just R? Keeping it customizable. standard is often R or *. HostController uses button click, need to check if there was a key.
        // Waiting to check HostController for record key. 
        // Logic: space for play/pause is standard.
        category: "transport"
    },

    // Global
    {
        id: "project.save",
        description: "shortcut.save_project",
        defaultKeys: [{ key: "s", modifiers: ["Control"] }, { key: "s", modifiers: ["Meta"] }],
        category: "global"
    },
    {
        id: "edit.undo",
        description: "shortcut.undo",
        defaultKeys: [{ key: "z", modifiers: ["Control"] }, { key: "z", modifiers: ["Meta"] }],
        category: "global"
    },
    {
        id: "edit.redo",
        description: "shortcut.redo",
        defaultKeys: [
            { key: "Z", modifiers: ["Control", "Shift"] }, // capital Z implies shift usually but better be explicit if logic handles it
            { key: "y", modifiers: ["Control"] },
            { key: "Z", modifiers: ["Meta", "Shift"] },
            { key: "y", modifiers: ["Meta"] }
        ],
        category: "global"
    },

    // Tools
    {
        id: "tool.select",
        description: "shortcut.tool_select",
        defaultKeys: [{ key: "1" }],
        category: "tools"
    },
    {
        id: "tool.pen",
        description: "shortcut.tool_pen",
        defaultKeys: [{ key: "2" }],
        category: "tools"
    },

    // Editor
    {
        id: "editor.zoomIn",
        description: "shortcut.zoom_in",
        defaultKeys: [{ key: "ArrowRight", modifiers: ["Control"] }],
        category: "editor"
    },
    {
        id: "editor.zoomOut",
        description: "shortcut.zoom_out",
        defaultKeys: [{ key: "ArrowLeft", modifiers: ["Control"] }],
        category: "editor"
    },
    {
        id: "editor.split",
        description: "shortcut.split",
        defaultKeys: [{ key: "s" }], // Note: conflict with ctrl+s? No, plain 's'.
        category: "editor"
    },
    {
        id: "editor.merge",
        description: "shortcut.merge",
        defaultKeys: [{ key: "m" }],
        category: "editor"
    },
    {
        id: "editor.delete",
        description: "shortcut.delete",
        defaultKeys: [{ key: "Delete" }, { key: "Backspace" }],
        category: "editor"
    },
    {
        id: "edit.copy",
        description: "shortcut.copy",
        defaultKeys: [{ key: "c", modifiers: ["Control"] }, { key: "c", modifiers: ["Meta"] }],
        category: "editor"
    },
    {
        id: "edit.cut",
        description: "shortcut.cut",
        defaultKeys: [{ key: "x", modifiers: ["Control"] }, { key: "x", modifiers: ["Meta"] }],
        category: "editor"
    },
    {
        id: "edit.paste",
        description: "shortcut.paste",
        defaultKeys: [{ key: "v", modifiers: ["Control"] }, { key: "v", modifiers: ["Meta"] }],
        category: "editor"
    },
    {
        id: "edit.selectAll",
        description: "shortcut.select_all",
        defaultKeys: [{ key: "a", modifiers: ["Control"] }, { key: "a", modifiers: ["Meta"] }],
        category: "editor"
    },
    {
        id: "editor.deselect",
        description: "shortcut.deselect",
        defaultKeys: [{ key: "Escape" }],
        category: "editor"
    }
];
