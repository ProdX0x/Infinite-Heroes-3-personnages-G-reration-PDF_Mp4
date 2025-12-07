/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { ComicFace, INITIAL_PAGES, GATE_PAGE } from './types';
import { LoadingFX } from './LoadingFX';

interface PanelProps {
    face?: ComicFace;
    allFaces: ComicFace[]; // Needed for cover "printing" status
    isExporting: boolean;
    onChoice: (pageIndex: number, choice: string) => void;
    onOpenBook: () => void;
    onDownloadPDF: () => void;
    onDownloadVideo: () => void;
    onReset: () => void;
}

export const Panel: React.FC<PanelProps> = ({ face, allFaces, isExporting, onChoice, onOpenBook, onDownloadPDF, onDownloadVideo, onReset }) => {
    if (!face) return <div className="w-full h-full bg-gray-950" />;
    if (face.isLoading && !face.imageUrl) return <LoadingFX />;
    
    const isFullBleed = face.type === 'cover' || face.type === 'back_cover';

    return (
        <div className={`panel-container relative group ${isFullBleed ? '!p-0 !bg-[#0a0a0a]' : ''}`}>
            <div className="gloss"></div>
            {face.imageUrl && <img src={face.imageUrl} alt="Comic panel" className={`panel-image ${isFullBleed ? '!object-cover' : ''}`} />}
            
            {/* Decision Buttons */}
            {face.isDecisionPage && face.choices.length > 0 && (
                <div className={`absolute bottom-0 inset-x-0 p-6 pb-12 flex flex-col gap-3 items-center justify-end transition-opacity duration-500 ${face.resolvedChoice ? 'opacity-0 pointer-events-none' : 'opacity-100'} bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20`}>
                    <p className="text-white font-comic text-2xl uppercase tracking-widest animate-pulse">What drives you?</p>
                    {face.choices.map((choice, i) => (
                        <button key={i} onClick={(e) => { e.stopPropagation(); if(face.pageIndex) onChoice(face.pageIndex, choice); }}
                          className={`comic-btn w-full py-3 text-xl font-bold tracking-wider ${i===0?'bg-yellow-400 hover:bg-yellow-300':'bg-blue-500 text-white hover:bg-blue-400'}`}>
                            {choice}
                        </button>
                    ))}
                </div>
            )}

            {/* Cover Action */}
            {face.type === 'cover' && (
                 <div className="absolute bottom-20 inset-x-0 flex justify-center z-20">
                     <button onClick={(e) => { e.stopPropagation(); onOpenBook(); }}
                      disabled={!allFaces.find(f => f.pageIndex === GATE_PAGE)?.imageUrl}
                      className="comic-btn bg-yellow-400 px-10 py-4 text-3xl font-bold hover:scale-105 animate-bounce disabled:animate-none disabled:bg-gray-400 disabled:cursor-wait">
                         {(!allFaces.find(f => f.pageIndex === GATE_PAGE)?.imageUrl) ? `PRINTING... ${allFaces.filter(f => f.type==='story' && f.imageUrl && (f.pageIndex||0) <= GATE_PAGE).length}/${INITIAL_PAGES}` : 'READ ISSUE #1'}
                     </button>
                 </div>
            )}

            {/* Back Cover Actions */}
            {face.type === 'back_cover' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8 bg-black/60 backdrop-blur-sm">
                     <h2 className="font-comic text-4xl text-yellow-400 mb-6 drop-shadow-[2px_2px_0_rgba(0,0,0,1)] tracking-wide uppercase">Collect Your Issue</h2>
                     
                     <div className="flex flex-col gap-4 w-full max-w-xs mb-8">
                         <button onClick={(e) => { e.stopPropagation(); onDownloadPDF(); }} 
                                 className="comic-btn bg-white text-black px-6 py-3 text-lg font-bold hover:bg-gray-100 flex items-center justify-between">
                             <span>📄 PDF (COMIC)</span>
                             <span className="text-sm text-gray-500">PRINTABLE</span>
                         </button>
                         
                         <button onClick={(e) => { e.stopPropagation(); onDownloadVideo(); }} 
                                 disabled={isExporting}
                                 className="comic-btn bg-blue-500 text-white px-6 py-3 text-lg font-bold hover:bg-blue-400 disabled:bg-gray-500 flex items-center justify-between">
                             <span>🎥 VIDEO (MP4)</span>
                             <span className="text-sm text-blue-100">{isExporting ? 'RENDERING...' : 'SLIDESHOW'}</span>
                         </button>
                     </div>

                    <button onClick={(e) => { e.stopPropagation(); onReset(); }} className="comic-btn bg-green-500 text-white px-8 py-3 text-xl font-bold hover:scale-105 uppercase tracking-wider">
                        Create New Issue
                    </button>
                </div>
            )}
        </div>
    );
}