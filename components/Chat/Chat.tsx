import { IconClearAll, IconSettings } from '@tabler/icons-react';
import {
  MutableRefObject,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';
import { ModelID, getWindowAI } from 'window.ai';

import { useTranslation } from 'next-i18next';

import { getEndpoint } from '@/utils/app/api';
import {
  saveConversation,
  saveConversations,
  updateConversation,
} from '@/utils/app/conversation';
import { throttle } from '@/utils/data/throttle';

import { ChatBody, Conversation, Message } from '@/types/chat';
import {
  OpenAIModel,
  OpenAIModels,
  WindowAIModels,
} from '@/types/openai';
import { Plugin } from '@/types/plugin';

import HomeContext from '@/pages/api/home/home.context';

import Spinner from '../Spinner';
import { ChatInput } from './ChatInput';
import { ChatLoader } from './ChatLoader';
import { ErrorMessageDiv } from './ErrorMessageDiv';
import { MemoizedChatMessage } from './MemoizedChatMessage';
import { ModelSelect } from './ModelSelect';
import { SystemPrompt } from './SystemPrompt';
import { TemperatureSlider } from './Temperature';

interface Props {
  stopConversationRef: MutableRefObject<boolean>;
}

export const Chat = memo(({ stopConversationRef }: Props) => {
  const { t } = useTranslation('chat');

  const {
    state: {
      selectedConversation,
      conversations,
      models,
      apiKey,
      pluginKeys,
      serverSideApiKeyIsSet,
      messageIsStreaming,
      modelError,
      loading,
      prompts,
      windowaiEnabled,
      windowai,
      openrouterApiKey
    },
    handleUpdateConversation,
    dispatch: homeDispatch,
  } = useContext(HomeContext);

  useEffect(() => {
    if (windowaiEnabled) {
      console.log(windowai)
    }
  }, [windowai]);

  const [currentMessage, setCurrentMessage] = useState<Message>();
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showScrollDownButton, setShowScrollDownButton] =
    useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(
    async (message: Message, deleteCount = 0, plugin: Plugin | null = null) => {
      console.log(windowai)
      if(windowaiEnabled && !windowai){
        toast.loading("window.ai initalizing, or not installed", {duration: 1000});
        return
      }
      if (selectedConversation) {
        let updatedConversation: Conversation;
        if (deleteCount) {
          const updatedMessages = [...selectedConversation.messages];
          for (let i = 0; i < deleteCount; i++) {
            updatedMessages.pop();
          }
          updatedConversation = {
            ...selectedConversation,
            messages: [...updatedMessages, message],
          };
        } else {
          updatedConversation = {
            ...selectedConversation,
            messages: [...selectedConversation.messages, message],
          };
        }
        homeDispatch({
          field: 'selectedConversation',
          value: updatedConversation,
        });
        homeDispatch({ field: 'loading', value: true });
        homeDispatch({ field: 'messageIsStreaming', value: true });
        const chatBody: ChatBody = {
          model: updatedConversation.model,
          messages: updatedConversation.messages,
          key: openrouterApiKey,
          prompt: updatedConversation.prompt,
          temperature: updatedConversation.temperature,
        };
        const endpoint = getEndpoint(plugin);
        let body;
        if (!plugin) {
          body = JSON.stringify(chatBody);
        } else {
          body = JSON.stringify({
            ...chatBody,
            googleAPIKey: pluginKeys
              .find((key) => key.pluginId === 'google-search')
              ?.requiredKeys.find((key) => key.key === 'GOOGLE_API_KEY')?.value,
            googleCSEId: pluginKeys
              .find((key) => key.pluginId === 'google-search')
              ?.requiredKeys.find((key) => key.key === 'GOOGLE_CSE_ID')?.value,
          });
        }
        const controller = new AbortController();
        let response;
        if (windowaiEnabled && windowai) {
          const windowReader = new ReadableStream({
            async start(controller: any) {
              let controllerClosed = false;
              try {
                await windowai.generateText(
                  {
                    messages: [
                      {role: "system", content: chatBody.prompt},
                      ...chatBody.messages,]
                  },
                  {
                    temperature: chatBody.temperature,
                    maxTokens: 1000,
                    onStreamResult: (res: any) => {
                      if (controllerClosed) {
                        return;
                      }
                      if(!res){
                        return;
                      }
                      controller.enqueue(
                        new TextEncoder().encode(res.message.content),
                      );
                    },
                  },
                );
                controller.close()
              } catch (error) {
                console.error('Error during text generation:', error);
                homeDispatch({ field: 'loading', value: false });
                homeDispatch({ field: 'messageIsStreaming', value: false });
                toast.error('An error occurred during window.ai text generation.', {
                  id: 'error-during-text-generation',
                });
                return;
              }
            },
          });
          response = new Response(windowReader);
        } else if(openrouterApiKey){
          console.log('using openrouter');
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // hardcoded into the request
              // 'HTTP-Referer': 'https://chatbot-ui-window-ai-git-windowai-skylight-ai.vercel.app/',
              // 'X-Title': 'Chatbot UI'
            },
            signal: controller.signal,
            body,
          });
        } else {
          throw new Error('Must use OpenRouter or Window AI');
        }
        if (!response.ok) {
          homeDispatch({ field: 'loading', value: false });
          homeDispatch({ field: 'messageIsStreaming', value: false });
          toast.error(response.statusText);
          return;
        }
        const data = response.body;
        if (!data) {
          homeDispatch({ field: 'loading', value: false });
          homeDispatch({ field: 'messageIsStreaming', value: false });
          return;
        }
        if (!plugin) {
          if (updatedConversation.messages.length === 1) {
            const { content } = message;
            const customName =
              content.length > 30 ? content.substring(0, 30) + '...' : content;
            updatedConversation = {
              ...updatedConversation,
              name: customName,
            };
          }
          homeDispatch({ field: 'loading', value: false });
          const reader = data.getReader();
          const decoder = new TextDecoder();
          let done = false;
          let isFirst = true;
          let text = '';
          while (!done) {
            if (stopConversationRef.current === true) {
              controller.abort();
              done = true;
              break;
            }
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            const chunkValue = decoder.decode(value);
            text += chunkValue;
            if (isFirst) {
              isFirst = false;
              const updatedMessages: Message[] = [
                ...updatedConversation.messages,
                { role: 'assistant', content: chunkValue },
              ];
              updatedConversation = {
                ...updatedConversation,
                messages: updatedMessages,
              };
              homeDispatch({
                field: 'selectedConversation',
                value: updatedConversation,
              });
            } else {
              const updatedMessages: Message[] =
                updatedConversation.messages.map((message, index) => {
                  if (index === updatedConversation.messages.length - 1) {
                    return {
                      ...message,
                      content: text,
                    };
                  }
                  return message;
                });
              updatedConversation = {
                ...updatedConversation,
                messages: updatedMessages,
              };
              homeDispatch({
                field: 'selectedConversation',
                value: updatedConversation,
              });
            }
          }
          saveConversation(updatedConversation);
          const updatedConversations: Conversation[] = conversations.map(
            (conversation) => {
              if (conversation.id === selectedConversation.id) {
                return updatedConversation;
              }
              return conversation;
            },
          );
          if (updatedConversations.length === 0) {
            updatedConversations.push(updatedConversation);
          }
          homeDispatch({ field: 'conversations', value: updatedConversations });
          saveConversations(updatedConversations);
          homeDispatch({ field: 'messageIsStreaming', value: false });
        } else {
          const { answer } = await response.json();
          const updatedMessages: Message[] = [
            ...updatedConversation.messages,
            { role: 'assistant', content: answer },
          ];
          updatedConversation = {
            ...updatedConversation,
            messages: updatedMessages,
          };
          homeDispatch({
            field: 'selectedConversation',
            value: updateConversation,
          });
          saveConversation(updatedConversation);
          const updatedConversations: Conversation[] = conversations.map(
            (conversation) => {
              if (conversation.id === selectedConversation.id) {
                return updatedConversation;
              }
              return conversation;
            },
          );
          if (updatedConversations.length === 0) {
            updatedConversations.push(updatedConversation);
          }
          homeDispatch({ field: 'conversations', value: updatedConversations });
          saveConversations(updatedConversations);
          homeDispatch({ field: 'loading', value: false });
          homeDispatch({ field: 'messageIsStreaming', value: false });
        }
      }
    },
    [
      apiKey,
      conversations,
      pluginKeys,
      selectedConversation,
      stopConversationRef,
      windowai,
      openrouterApiKey,
      windowaiEnabled
    ],
  );

  const scrollToBottom = useCallback(() => {
    if (autoScrollEnabled) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      textareaRef.current?.focus();
    }
  }, [autoScrollEnabled]);

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        chatContainerRef.current;
      const bottomTolerance = 30;

      if (scrollTop + clientHeight < scrollHeight - bottomTolerance) {
        setAutoScrollEnabled(false);
        setShowScrollDownButton(true);
      } else {
        setAutoScrollEnabled(true);
        setShowScrollDownButton(false);
      }
    }
  };

  const handleScrollDown = () => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  };

  const handleSettings = () => {
    setShowSettings(!showSettings);
  };

  const onClearAll = () => {
    if (
      confirm(t<string>('Are you sure you want to clear all messages?')) &&
      selectedConversation
    ) {
      handleUpdateConversation(selectedConversation, {
        key: 'messages',
        value: [],
      });
    }
  };

  const scrollDown = () => {
    if (autoScrollEnabled) {
      messagesEndRef.current?.scrollIntoView(true);
    }
  };
  const throttledScrollDown = throttle(scrollDown, 250);

  // useEffect(() => {
  //   console.log('currentMessage', currentMessage);
  //   if (currentMessage) {
  //     handleSend(currentMessage);
  //     homeDispatch({ field: 'currentMessage', value: undefined });
  //   }
  // }, [currentMessage]);

  useEffect(() => {
    throttledScrollDown();
    selectedConversation &&
      setCurrentMessage(
        selectedConversation.messages[selectedConversation.messages.length - 2],
      );
  }, [selectedConversation, throttledScrollDown]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setAutoScrollEnabled(entry.isIntersecting);
        if (entry.isIntersecting) {
          textareaRef.current?.focus();
        }
      },
      {
        root: null,
        threshold: 0.5,
      },
    );
    const messagesEndElement = messagesEndRef.current;
    if (messagesEndElement) {
      observer.observe(messagesEndElement);
    }
    return () => {
      if (messagesEndElement) {
        observer.unobserve(messagesEndElement);
      }
    };
  }, [messagesEndRef]);

  enum EventType {
    // Fired when the user's model is changed.
    ModelChanged = 'model_changed',
    // Fired for errors
    Error = 'error',
  }
  const waitForAI = async (): Promise<boolean> => {
    let timeoutCounter = 0;

    while (!(window as any).ai) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      timeoutCounter += 100;

      if (timeoutCounter >= 1000) {
        return false;
      }
    }

    return true;
  };
  useEffect(() => {
    if (!windowaiEnabled) {
      console.log('windowai not enabled');
      toast.dismiss('window-ai-detected');
      toast.dismiss('window-ai-not-detected');
      return;
    }
    const checkForAI = async () => {
      if (!windowaiEnabled) {
        return;
      }
      const aiDetected = await waitForAI();
      if (aiDetected) {
        await homeDispatch({ field: 'windowai', value: await getWindowAI() });
        toast.success('window.ai detected', {
          id: 'window-ai-detected',
        });
      } else {
        // You can replace this with the toast.custom call or any other desired action
        toast.custom(
          <div className="bg-indigo-800 p-5 rounded-xl shadow-lg flex flex-col items-center space-y-4 transition-all duration-300 ease-in-out hover:shadow-xl">
            <p className="text-lg font-semibold text-indigo-200">
              Install the window.ai extension.
            </p>
            <a
              href="https://windowai.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-400 transition-colors duration-300 ease-in-out"
            >
              Visit windowai.io
            </a>
          </div>,
          {
            id: 'window-ai-not-detected',
            duration: 100000,
          },
        );
      }
    };

    checkForAI();
  }, [windowaiEnabled, homeDispatch]);

  useEffect(() => {
    const handleEvent = (event: EventType, data: unknown) => {
      if (event === EventType.ModelChanged) {
        let models = windowai
          .getCurrentModel()
          .then((modelID: ModelID) => {
              if(Object.values(ModelID).includes(modelID)){
                return [WindowAIModels[modelID]]
              }
              else{
                return [
                  {
                    id: modelID ? modelID : 'externalOrLocal',
                    name: modelID ? modelID : 'External Model',
                    maxLength: 100000,
                    tokenLimit: 100000,
                  },
                ];
              }
            }
          );
        models.then((models: any) => {
          homeDispatch({ field: 'models', value: models });
        });
      }
    };
    if (windowai) {
      windowai.addEventListener(handleEvent);
    }
  }, [windowai]);
  return (
    <div className="relative flex-1 overflow-hidden bg-white dark:bg-[#343541]">
      {/* TODO: better window.ai detection */}
      {!(apiKey || serverSideApiKeyIsSet || (windowaiEnabled && windowai) || (openrouterApiKey))  ? (
        <div className="mx-auto flex h-full w-[300px] flex-col justify-center space-y-6 sm:w-[600px]">
          <div className="text-center text-4xl font-bold text-black dark:text-white">
            Welcome to Chatbot UI
          </div>
          <div className="text-center text-lg text-black dark:text-white">
            <div className="mb-0">{`Chatbot UI is an open source clone of OpenAI's ChatGPT UI.`}</div>
          </div>
          <div className="text-center text-gray-500 dark:text-gray-400">
            <div className="mb-2 text-md">
              Chatbot UI allows you to connect to <a
                href="https://openrouter.ai"
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline"
              >
                {" "} OpenRouter
              </a> or  <a
                href="https://windowai.io"
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline"
              >
                {" "} window.ai
              </a> and chat with multiple models. Please click on <span className="font-bold">Login with Openrouter</span> in the bottom left or
              use <a
                href="https://windowai.io"
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline"
              >
                {" "} window.ai
              </a>.
            </div>
            <div className="mb-2">
              Your keys are only used to communicate with the OpenRouter API. The code is opensource - available  <a
                href="https://github.com/SkylightAI/chatbot-ui"
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:underline"
              >
                here.
              </a>
            </div>
            <div>
            </div>
          </div>
        </div>
      ) : modelError ? (
        <ErrorMessageDiv error={modelError} />
      ) : (
        <>
          <div
            className="max-h-full overflow-x-hidden"
            ref={chatContainerRef}
            onScroll={handleScroll}
          >
            {selectedConversation?.messages.length === 0 ? (
              <>
                <div className="mx-auto flex flex-col space-y-5 md:space-y-10 px-3 pt-5 md:pt-12 sm:max-w-[600px]">
                  <div className="text-center text-3xl font-semibold text-gray-800 dark:text-gray-100">
                    {models.length === 0 ? (
                      <div>
                        <Spinner size="16px" className="mx-auto" />
                      </div>
                    ) : (
                      `Chatbot UI${windowaiEnabled ? ' x window.ai' : ''}`
                    )}
                  </div>

                  {models.length > 0 && (
                    <div className="flex h-full flex-col space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-600">
                      <ModelSelect />

                      <SystemPrompt
                        conversation={selectedConversation}
                        prompts={prompts}
                        onChangePrompt={(prompt) =>
                          handleUpdateConversation(selectedConversation, {
                            key: 'prompt',
                            value: prompt,
                          })
                        }
                      />

                      <TemperatureSlider
                        label={t('Temperature')}
                        onChangeTemperature={(temperature) =>
                          handleUpdateConversation(selectedConversation, {
                            key: 'temperature',
                            value: temperature,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="sticky top-0 z-10 flex justify-center border border-b-neutral-300 bg-neutral-100 py-2 text-sm text-neutral-500 dark:border-none dark:bg-[#444654] dark:text-neutral-200">
                  {t('Model')}: {selectedConversation?.model.name} | {t('Temp')}
                  : {selectedConversation?.temperature} |
                  <button
                    className="ml-2 cursor-pointer hover:opacity-50"
                    onClick={handleSettings}
                  >
                    <IconSettings size={18} />
                  </button>
                  <button
                    className="ml-2 cursor-pointer hover:opacity-50"
                    onClick={onClearAll}
                  >
                    <IconClearAll size={18} />
                  </button>
                </div>
                {showSettings && (
                  <div className="flex flex-col space-y-10 md:mx-auto md:max-w-xl md:gap-6 md:py-3 md:pt-6 lg:max-w-2xl lg:px-0 xl:max-w-3xl">
                    <div className="flex h-full flex-col space-y-4 border-b border-neutral-200 p-4 dark:border-neutral-600 md:rounded-lg md:border">
                      <ModelSelect />
                    </div>
                  </div>
                )}

                {selectedConversation?.messages.map((message, index) => (
                  <MemoizedChatMessage
                    key={index}
                    message={message}
                    messageIndex={index}
                    onEdit={(editedMessage) => {
                      setCurrentMessage(editedMessage);
                      // discard edited message and the ones that come after then resend
                      handleSend(
                        editedMessage,
                        selectedConversation?.messages.length - index,
                        null
                      );
                    }}
                  />
                ))}

                {loading && <ChatLoader />}

                <div
                  className="h-[162px] bg-white dark:bg-[#343541]"
                  ref={messagesEndRef}
                />
              </>
            )}
          </div>

          <ChatInput
            stopConversationRef={stopConversationRef}
            textareaRef={textareaRef}
            onSend={(message, plugin) => {
              setCurrentMessage(message);
              handleSend(message, 0, plugin);
            }}
            onScrollDownClick={handleScrollDown}
            onRegenerate={() => {
              if (currentMessage) {
                handleSend(currentMessage, 2, null);
              }
            }}
            showScrollDownButton={showScrollDownButton}
          />
        </>
      )}
    </div>
  );
});
Chat.displayName = 'Chat';
