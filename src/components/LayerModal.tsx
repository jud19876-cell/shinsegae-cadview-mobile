/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Search, Layers, ArrowRight } from 'lucide-react';
import { LayerInfo, TextEntity } from '../types/cad';
import { resolveCadColorValue } from '../lib/cadColors';

interface LayerModalProps {
  isOpen: boolean;
  theme: 'white' | 'dark' | 'blueprint';
  layers: Record<string, LayerInfo>;
  textEntities: TextEntity[];
  onClose: () => void;
  onToggleLayer: (layerName: string) => void;
  onShowAllLayers: () => void;
  onHideAllLayers: () => void;
  onJumpToText: (textEnt: TextEntity) => void;
}

export const LayerModal: React.FC<LayerModalProps> = ({
  isOpen,
  theme,
  layers,
  textEntities,
  onClose,
  onToggleLayer,
  onShowAllLayers,
  onHideAllLayers,
  onJumpToText,
}) => {
  const [activeTab, setActiveTab] = useState<'layers' | 'search'>('layers');
  const [layerFilter, setLayerFilter] = useState('');
  const [textSearch, setTextSearch] = useState('');

  if (!isOpen) return null;

  const layerKeys = Object.keys(layers).sort();
  const filteredLayerKeys = layerKeys.filter((k) =>
    layerFilter ? k.toLowerCase().includes(layerFilter.toLowerCase()) : true
  );

  const filteredTexts = textEntities.filter((e) =>
    textSearch ? e.text.toLowerCase().includes(textSearch.toLowerCase()) : true
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white border border-slate-200 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header Tabs */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('layers')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                activeTab === 'layers'
                  ? 'bg-[#C8102E] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#1A1A1A]'
              }`}
            >
              레이어 ({layerKeys.length})
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                activeTab === 'search'
                  ? 'bg-[#1A1A1A] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#1A1A1A]'
              }`}
            >
              도면 문자 검색 ({textEntities.length})
            </button>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-[#1A1A1A] p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab 1: Layers Content */}
        {activeTab === 'layers' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="레이어 이름 검색..."
                  value={layerFilter}
                  onChange={(e) => setLayerFilter(e.target.value)}
                  className="w-full bg-[#F8F9FA] border border-slate-300 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#C8102E]"
                />
              </div>
              <button
                onClick={onShowAllLayers}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-[#1A1A1A] border border-slate-200"
              >
                모두 켜기
              </button>
              <button
                onClick={onHideAllLayers}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-[#1A1A1A] border border-slate-200"
              >
                모두 끄기
              </button>
            </div>

            <div className="p-3 space-y-1.5 overflow-y-auto custom-scrollbar flex-1">
              {filteredLayerKeys.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">
                  일치하는 레이어가 없습니다.
                </p>
              ) : (
                filteredLayerKeys.map((k) => {
                  const lyr = layers[k];
                  const dotColor = resolveCadColorValue(lyr.aci, theme);
                  return (
                    <div
                      key={k}
                      className="flex items-center justify-between p-2 rounded-xl bg-[#F8F9FA] border border-slate-200"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/15 shadow-xs"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span
                          className={`text-xs font-semibold truncate ${
                            lyr.visible
                              ? 'text-[#1A1A1A]'
                              : 'text-slate-400 line-through'
                          }`}
                        >
                          {lyr.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          ({lyr.count})
                        </span>
                      </div>
                      <button
                        onClick={() => onToggleLayer(k)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                          lyr.visible
                            ? 'bg-[#C8102E] text-white'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {lyr.visible ? '켜짐' : '꺼짐'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Text Search Content */}
        {activeTab === 'search' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-200">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="설비명, 실명, 치수, 부품 번호 검색..."
                  value={textSearch}
                  onChange={(e) => setTextSearch(e.target.value)}
                  className="w-full bg-[#F8F9FA] border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#1A1A1A] focus:outline-none focus:border-[#C8102E]"
                />
              </div>
            </div>

            <div className="p-3 space-y-1.5 overflow-y-auto custom-scrollbar flex-1">
              {filteredTexts.length === 0 ? (
                <div className="text-center py-8 text-slate-400 space-y-1">
                  <Layers className="w-6 h-6 mx-auto opacity-40 mb-1" />
                  <p className="text-xs">일치하는 도면 텍스트가 없습니다.</p>
                </div>
              ) : (
                filteredTexts.slice(0, 100).map((ent) => (
                  <button
                    key={ent.id}
                    onClick={() => {
                      onJumpToText(ent);
                      onClose();
                    }}
                    className="w-full text-left p-2.5 rounded-xl bg-[#F8F9FA] hover:bg-slate-100 border border-slate-200 flex items-center justify-between gap-2 transition"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#1A1A1A] truncate">
                        {ent.text}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        Layer: {ent.layer} · H: {Math.round(ent.height)}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#C8102E] font-bold shrink-0 flex items-center gap-0.5">
                      이동 <ArrowRight className="w-3 h-3" />
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
