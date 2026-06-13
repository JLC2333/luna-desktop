import { LAppDelegate } from './lappdelegate';
import { setCanvas, ModelDir } from './lappdefine';
import { CubismFramework } from '@framework/live2dcubismframework';

const app = LAppDelegate.getInstance();

function getActiveModel(): any {
  const sub = app.getSubdelegate();
  if (!sub) return null;
  const mgr = sub.getLive2DManager();
  return mgr._models?.[0] ?? null;
}

const _catParams: Record<string, Record<string, number>> = {};

const l2d: any = {
  _app: app,
  initialize() {
    const canvas = document.getElementById('live2d') as HTMLCanvasElement;
    if (!canvas) return false;
    setCanvas(canvas);
    if (!app.initialize()) return false;
    return true;
  },
  run() { app.run(); },

  changeModel(index: number) {
    const sub = app.getSubdelegate();
    if (!sub || index < 0 || index >= ModelDir.length) return;
    Object.keys(_catParams).forEach(k => delete _catParams[k]);
    sub.getLive2DManager().addModel(index);
  },

  nextModel() {
    const sub = app.getSubdelegate();
    if (!sub) return;
    Object.keys(_catParams).forEach(k => delete _catParams[k]);
    sub.getLive2DManager().nextScene();
  },

  async applyExpression(name: string, category: string) {
    const model = getActiveModel();
    if (!model || !model.getModel()) return;
    const cubismModel = model.getModel();
    const prev = _catParams[category] || {};
    const idMgr = CubismFramework.getIdManager();
    Object.keys(prev).forEach(paramId => {
      const id = idMgr.getId(paramId);
      if (id) cubismModel.addParameterValueById(id, -prev[paramId]);
    });
    const currentIndex = (window as any)._currentModel ?? 1;
    const modelKey = ModelDir[currentIndex] || '菜菜女仆';
    const url = `/live2d/model/${modelKey}/${name}.exp3.json`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const expData = await resp.json();
      const newParams: Record<string, number> = {};
      if (expData.Parameters) {
        expData.Parameters.forEach((p: any) => {
          const id = idMgr.getId(p.Id);
          if (id) cubismModel.addParameterValueById(id, p.Value);
          newParams[p.Id] = p.Value;
        });
      }
      _catParams[category] = newParams;
      cubismModel.update();
    } catch (e) {
      Object.keys(prev).forEach(paramId => {
        const id = idMgr.getId(paramId);
        if (id) cubismModel.addParameterValueById(id, prev[paramId]);
      });
      _catParams[category] = prev;
      console.error('[L2D] applyExpression failed:', name, e);
    }
  },

  setDrag(_x: number, _y: number) {}
};
(window as any).LunaL2D = l2d;
