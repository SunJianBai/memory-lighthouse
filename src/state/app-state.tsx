import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  exportAppState,
  importAppState,
  loadAppState,
  resetAppState,
  saveAppState,
} from "../data/storage";
import type {
  AppState,
  CareEvent,
  StoredAsset,
} from "../domain/types";

type AppStateContextValue = {
  state: AppState;
  updateState: (updater: (current: AppState) => AppState) => void;
  addEvent: (event: Omit<CareEvent, "id">) => CareEvent;
  addAsset: (asset: StoredAsset) => void;
  deleteAsset: (assetId: string) => void;
  exportData: () => void;
  importData: (file: File) => Promise<void>;
  resetData: () => void;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export const AppStateProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<AppState>(() => loadAppState());

  useEffect(() => {
    saveAppState(state);
  }, [state]);

  useEffect(() => {
    const reload = () => setState(loadAppState());
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, []);

  const updateState = useCallback(
    (updater: (current: AppState) => AppState) => setState(updater),
    [],
  );

  const addEvent = useCallback(
    (event: Omit<CareEvent, "id">) => {
      const next: CareEvent = { ...event, id: crypto.randomUUID() };
      setState((current) => ({
        ...current,
        events: [next, ...current.events].slice(0, 200),
      }));
      return next;
    },
    [],
  );

  const addAsset = useCallback((asset: StoredAsset) => {
    setState((current) => ({
      ...current,
      assets: [asset, ...current.assets.filter((item) => item.id !== asset.id)],
    }));
  }, []);

  const deleteAsset = useCallback((assetId: string) => {
    setState((current) => ({
      ...current,
      assets: current.assets.filter((asset) => asset.id !== assetId),
      recipient: {
        ...current.recipient,
        avatarAssetId:
          current.recipient.avatarAssetId === assetId
            ? undefined
            : current.recipient.avatarAssetId,
      },
      trustedPeople: current.trustedPeople.map((person) => ({
        ...person,
        faceAssetId:
          person.faceAssetId === assetId ? undefined : person.faceAssetId,
      })),
      medications: current.medications.map((medication) => ({
        ...medication,
        imageAssetId:
          medication.imageAssetId === assetId
            ? undefined
            : medication.imageAssetId,
      })),
      memories: current.memories.map((memory) => ({
        ...memory,
        assetId: memory.assetId === assetId ? undefined : memory.assetId,
      })),
    }));
  }, []);

  const value = useMemo<AppStateContextValue>(
    () => ({
      state,
      updateState,
      addEvent,
      addAsset,
      deleteAsset,
      exportData: () => exportAppState(state),
      importData: async (file) => setState(await importAppState(file)),
      resetData: () => setState(resetAppState()),
    }),
    [addAsset, addEvent, deleteAsset, state, updateState],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used within AppStateProvider");
  return value;
};
