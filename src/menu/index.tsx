import { Fragment, useState } from "react";
import { Dialog, Disclosure, Menu, Transition } from "@headlessui/react";
import {
  Bars3Icon,
  BellIcon,
  XMarkIcon,
  QuestionMarkCircleIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";

import { copyTextToClipboard } from "../app/utilities/Clipboard";

const navigation = [{ name: "Map", href: "#", current: true }];

function classNames(...classes: any) {
  return classes.filter(Boolean).join(" ");
}

const ShareButton = () => {
  let [isClicked, setIsClicked] = useState(false);
  const handleClick = () => {
    copyTextToClipboard(document.location.href);
    setIsClicked(true);
    setTimeout(() => setIsClicked(false), 1000); // 👈️ change text back after 1 second
  };
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      onClick={() => handleClick()}
    >
      <LinkIcon
        className="-ml-1 mr-2 h-5 w-5 text-gray-500"
        aria-hidden="true"
      />
      {isClicked ? "Copied!" : "Share"}
    </button>
  );
};

export const ProjectMenu = () => {
  let [isOpen, setIsOpen] = useState(() => {
    const state = localStorage.getItem("shouldShowHelp");

    return !state || state === "true";
  });

  const handleOnClick = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    localStorage.setItem("shouldShowHelp", "false");
    setIsOpen(false);
  };

  return (
    <Disclosure as="nav" className="relative z-10">
      {({ open }) => (
        <>
          <div className="mx-auto px-0 sm:px-4">
            <div className="relative flex h-12 items-center justify-between">
              {/* Mobile menu button*/}
              <div className="absolute inset-y-0 left-0 flex items-center sm:hidden">
                <Disclosure.Button className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white">
                  <span className="sr-only">Open main menu</span>
                  {open ? (
                    <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                  ) : (
                    <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                  )}
                </Disclosure.Button>
              </div>

              {/* Left Menu */}
              <div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
                {/* logo */}
                <div className="flex flex-shrink-0 items-center">
                  <span className="block h-8 w-auto text-3xl leading-none select-none align-bottom">
                    🤗
                  </span>
                  {/* <img
                    className="block h-8 w-auto lg:hidden"
                    src="https://tailwindui.com/img/logos/mark.svg?color=green&shade=500"
                    alt="Your Company"
                  />
                  <img
                    className="hidden h-8 w-auto lg:block"
                    src="https://tailwindui.com/img/logos/mark.svg?color=indigo&shade=500"
                    alt="Your Company"
                  /> */}
                </div>
                {/* navigation desktop */}
                <div className="hidden sm:ml-6 sm:block">
                  <div className="flex space-x-4">
                    {navigation.map((item) => (
                      <a
                        key={item.name}
                        href={item.href}
                        className={classNames(
                          item.current
                            ? "bg-gray-900 text-white"
                            : "text-gray-300 hover:bg-gray-700 hover:text-white",
                          "px-3 py-2 rounded-md text-sm font-medium"
                        )}
                        aria-current={item.current ? "page" : undefined}
                      >
                        {item.name}
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Menu */}
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0">
                {/* Profile dropdown */}
                <ShareButton />

                <Menu as="div" className="relative ml-3">
                  <div>
                    <Menu.Button className="rounded-full bg-gray-800 p-1 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-gray-800">
                      <span className="sr-only">Open help menu</span>
                      <QuestionMarkCircleIcon
                        className="h-6 w-6"
                        aria-hidden="true"
                      />
                    </Menu.Button>
                  </div>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <Menu.Item>
                        {({ active }) => (
                          <a
                            href="#"
                            className={classNames(
                              active ? "bg-gray-100" : "",
                              "block px-4 py-2 text-sm text-gray-700"
                            )}
                            onClick={() => handleOnClick()}
                          >
                            Getting Started
                          </a>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        <a
                          href="#"
                          className="block px-4 py-2 text-sm text-gray-400 cursor-default	"
                        >
                          {`v${__APP_VERSION__}`}
                        </a>
                      </Menu.Item>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
            </div>
          </div>

          {/* navigation mobile */}
          <Disclosure.Panel className="sm:hidden z-50">
            <div className="space-y-1 px-2 pt-2 pb-3">
              {navigation.map((item) => (
                <Disclosure.Button
                  key={item.name}
                  as="a"
                  href={item.href}
                  className={classNames(
                    item.current
                      ? "bg-gray-900 text-white"
                      : "text-gray-300 hover:bg-gray-700 hover:text-white",
                    "block px-3 py-2 rounded-md text-base font-medium"
                  )}
                  aria-current={item.current ? "page" : undefined}
                >
                  {item.name}
                </Disclosure.Button>
              ))}
            </div>
          </Disclosure.Panel>

          {/* Help Dialog Box */}
          <Transition.Root show={isOpen} as={Fragment}>
            <Dialog
              as="div"
              className="relative z-10"
              onClose={() => handleClose()}
            >
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
              </Transition.Child>

              <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                  <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                    enterTo="opacity-100 translate-y-0 sm:scale-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                    leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                  >
                    <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                      <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                        <div className="sm:flex sm:items-start">
                          <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                            <Dialog.Title
                              as="h3"
                              className="text-2xl font-medium leading-6 text-gray-900 pb-4"
                            >
                              Welcome to MapTogether Alpha
                            </Dialog.Title>
                            <div className="mt-2">
                              <p className="text-lg pb-2">
                                MapTogether is a multiplayer visual Wardley
                                Mapping tool. If you already know Wardley Mapping,
                                here are some tips to get started:
                              </p>
                              <ul className="list-disc list-inside">
                                <li>
                                  The left side of the screen is the canvas. The
                                  right side is the code editor. Unlike many
                                  Wardley Mapping tools, you shouldn't need to
                                  edit code much.
                                </li>
                                <li>
                                  Adding components: Double click on the canvas,
                                  type a component name, then press enter
                                </li>
                                <li>Renaming components: double click a component</li>
                                <li>
                                  Linking components: Hold Ctrl/Cmd and click the
                                  first component, then the second component
                                </li>
                                <li>
                                  Selecting components: Click and drag on the canvas
                                </li>
                                <li>
                                  Moving components: Click and hold on a component
                                  and drag it
                                </li>
                                <li>
                                  Toggling component selection: Hold shift and drag
                                  or click to add to the selection. Click outside
                                  the selected components to deselect
                                </li>
                                <li>
                                  Deleting components: Press del/backspace
                                </li>
                                <li>
                                  Pipelines:
                                  currently pipelines only work by nesting
                                  other components in braces {" { }"} at the end
                                  of a component in the code editor.
                                </li>
                                <li>
                                  There will be bugs. If you find any please
                                  email benhohner@gmail.com or DM @bhohner on
                                  Twitter. Thanks!
                                </li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                        <button
                          type="button"
                          className="inline-flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
                          onClick={() => handleClose()}
                        >
                          Get Started
                        </button>
                      </div>
                    </Dialog.Panel>
                  </Transition.Child>
                </div>
              </div>
            </Dialog>
          </Transition.Root>
        </>
      )}
    </Disclosure>
  );
};
