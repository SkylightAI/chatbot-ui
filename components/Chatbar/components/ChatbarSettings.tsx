import { IconFileExport, IconSettings, IconBrandWindows, IconArrowsSplit} from '@tabler/icons-react';
import { useContext, useState } from 'react';
import { useRouter } from 'next/router';

import { useTranslation } from 'next-i18next';

import HomeContext from '@/pages/api/home/home.context';

import { SettingDialog } from '@/components/Settings/SettingDialog';

import { Import } from '../../Settings/Import';
import { Key } from '../../Settings/Key';
import { SidebarButton } from '../../Sidebar/SidebarButton';
import ChatbarContext from '../Chatbar.context';
import { ClearConversations } from './ClearConversations';
import { PluginKeys } from './PluginKeys';

export const ChatbarSettings = () => {
  const { t } = useTranslation('sidebar');
  const [isSettingDialogOpen, setIsSettingDialog] = useState<boolean>(false);

  const {
    state: {
      apiKey,
      lightMode,
      serverSideApiKeyIsSet,
      serverSidePluginKeysSet,
      conversations,
      windowaiEnabled,
      openrouterApiKey
    },
    dispatch: homeDispatch,
  } = useContext(HomeContext);

  const {
    handleClearConversations,
    handleImportConversations,
    handleExportData,
    clearOpenrouterKey,
  } = useContext(ChatbarContext);

  const router = useRouter();

  return (
    <div className="flex flex-col items-center space-y-1 border-t border-white/20 pt-1 text-sm">
      {conversations.length > 0 ? (
        <ClearConversations onClearConversations={handleClearConversations} />
      ) : null}

      <Import onImport={handleImportConversations} />

      <SidebarButton
        text={t('Export data')}
        icon={<IconFileExport size={18} />}
        onClick={() => handleExportData()}
      />

      <SidebarButton
        text={t('Settings')}
        icon={<IconSettings size={18} />}
        onClick={() => setIsSettingDialog(true)}
      />
      <SidebarButton
        text={!openrouterApiKey ? t('Login With OpenRouter') : "Clear OpenRouter API Key"}
        icon={<IconArrowsSplit size={18} />}
        onClick={() => {
          !openrouterApiKey ?
          router.push(`https://openrouter.ai/auth?callback_url=${window.location.origin + window.location.pathname}`) :
          clearOpenrouterKey()
        }}
      />
      <SidebarButton
        text={(windowaiEnabled ? 'Disable' : 'Enable') + ' Window AI'}
        icon={<IconBrandWindows size={18} />}
        onClick={() => {
          homeDispatch({
            field: 'windowaiEnabled',
            value: !windowaiEnabled,
          });
          localStorage.setItem('windowaiEnabled', (!windowaiEnabled).toString());
        }}
      />
      {/* {!windowaiEnabled ? (
        !serverSideApiKeyIsSet ? (
          <Key apiKey={apiKey} onApiKeyChange={handleApiKeyChange} />
        ) : null
      ) : null} */}

      {/* {!serverSidePluginKeysSet ? <PluginKeys /> : null} */}

      <SettingDialog
        open={isSettingDialogOpen}
        onClose={() => {
          setIsSettingDialog(false);
        }}
      />
      
    </div>
  );
};
