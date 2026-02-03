export const isDesktop = (): boolean => {
    // @ts-ignore
    return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
};
