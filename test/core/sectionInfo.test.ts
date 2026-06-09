import * as assert from 'assert';
import { getSectionInfoByContextValue, getSectionInfoByAssetType } from '../../src/core/sectionInfo';
import { AssetType } from '../../src/core/types';

describe('sectionInfo -- section explanations', () => {
  describe('getSectionInfoByContextValue', () => {
    const cases: [string, string][] = [
      ['assetGroupSkills', 'Skills'],
      ['assetGroupAgents', 'Agents'],
      ['assetGroupCommands', 'Commands'],
      ['assetGroupWorkflows', 'Workflows'],
      ['assetGroupMemory', 'Memory'],
      ['assetPluginsRoot', 'Plugins'],
      ['assetPluginsRootOutdated', 'Plugins'],
      ['assetProjectPluginsRoot', 'Plugins']
    ];

    for (const [contextValue, title] of cases) {
      it(`${contextValue} -> ${title}`, () => {
        const info = getSectionInfoByContextValue(contextValue);
        assert.ok(info, `expected info for ${contextValue}`);
        assert.strictEqual(info!.title, title);
        assert.ok(info!.summary.length > 0);
        assert.ok(info!.docUrl.startsWith('https://'));
      });
    }

    it('returns undefined for unrelated contextValues', () => {
      assert.strictEqual(getSectionInfoByContextValue('asset-md-global'), undefined);
      assert.strictEqual(getSectionInfoByContextValue('fsDir'), undefined);
      assert.strictEqual(getSectionInfoByContextValue(undefined), undefined);
    });
  });

  describe('getSectionInfoByAssetType', () => {
    it('maps grouped asset types to their section', () => {
      assert.strictEqual(getSectionInfoByAssetType(AssetType.Skill)!.title, 'Skills');
      assert.strictEqual(getSectionInfoByAssetType(AssetType.Subagent)!.title, 'Agents');
      assert.strictEqual(getSectionInfoByAssetType(AssetType.Command)!.title, 'Commands');
      assert.strictEqual(getSectionInfoByAssetType(AssetType.Workflow)!.title, 'Workflows');
      assert.strictEqual(getSectionInfoByAssetType(AssetType.Memory)!.title, 'Memory');
    });

    it('returns undefined for non-grouped types', () => {
      assert.strictEqual(getSectionInfoByAssetType(AssetType.ClaudeMd), undefined);
      assert.strictEqual(getSectionInfoByAssetType(AssetType.Config), undefined);
    });
  });
});
