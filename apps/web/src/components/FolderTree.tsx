'use client';

import React, { useState } from 'react';
import { ChevronRight, Folder, FolderOpen, MoreVertical } from 'lucide-react';
import { ConversationFolder } from '@/lib/api/folders';

interface FolderTreeProps {
  folders: ConversationFolder[];
  onSelectFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onRenameFolder?: (folderId: string, name: string) => void;
}

interface FolderItemProps {
  folder: ConversationFolder;
  level: number;
  onSelectFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onRenameFolder?: (folderId: string, name: string) => void;
}

function FolderItem({
  folder,
  level,
  onSelectFolder,
  onDeleteFolder,
  onRenameFolder,
}: FolderItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renamingValue, setRenamingValue] = useState(folder.name);
  const hasChildren = folder.children && folder.children.length > 0;

  const handleRenameSubmit = () => {
    if (renamingValue.trim() && renamingValue !== folder.name) {
      onRenameFolder?.(folder.id, renamingValue);
    }
    setIsRenaming(false);
    setRenamingValue(folder.name);
  };

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900 rounded transition group"
        style={{ paddingLeft: `${level * 16}px` }}
      >
        {hasChildren && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-0 hover:bg-gray-200 dark:hover:bg-gray-800 rounded"
          >
            <ChevronRight
              className={`h-4 w-4 text-gray-400 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          </button>
        )}
        {!hasChildren && <div className="w-4" />}

        <button
          onClick={() => onSelectFolder?.(folder.id)}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 text-amber-500 flex-shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-amber-500 flex-shrink-0" />
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={renamingValue}
              onChange={(e) => setRenamingValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') {
                  setIsRenaming(false);
                  setRenamingValue(folder.name);
                }
              }}
              className="flex-1 text-sm font-medium px-1 py-0 border rounded dark:bg-gray-800 dark:border-gray-700"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {folder.name}
            </span>
          )}
          {folder.conversationCount !== undefined && (
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              ({folder.conversationCount})
            </span>
          )}
        </button>

        <div className="opacity-0 group-hover:opacity-100 transition flex-shrink-0">
          <div className="relative group/menu">
            <button
              onClick={(e) => e.stopPropagation()}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded"
            >
              <MoreVertical className="h-4 w-4 text-gray-400" />
            </button>
            <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 opacity-0 group-hover/menu:opacity-100 pointer-events-none group-hover/menu:pointer-events-auto transition z-10">
              <button
                onClick={() => {
                  setIsRenaming(true);
                  setRenamingValue(folder.name);
                }}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t"
              >
                Rename
              </button>
              <button
                onClick={() => onDeleteFolder?.(folder.id)}
                className="block w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-b"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {folder.children!.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              onSelectFolder={onSelectFolder}
              onDeleteFolder={onDeleteFolder}
              onRenameFolder={onRenameFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree({
  folders,
  onSelectFolder,
  onDeleteFolder,
  onRenameFolder,
}: FolderTreeProps) {
  if (!folders || folders.length === 0) {
    return (
      <div className="px-2 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
        No folders yet
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          level={0}
          onSelectFolder={onSelectFolder}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
        />
      ))}
    </div>
  );
}
