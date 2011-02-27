// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * @instance browser
 */
var Browser = Module("browser", XPCOM(Ci.nsISupportsWeakReference, ModuleBase), {
    init: function init() {
        this.cleanupProgressListener = util.overlayObject(window.XULBrowserWindow,
                                                          this.progressListener);
        util.addObserver(this);
    },

    destroy: function () {
        this.cleanupProgressListener();
        this.observe.unregister();
    },

    observers: {
        "chrome-document-global-created": function (win, uri) { this.observe(win, "content-document-global-created", uri); },
        "content-document-global-created": function (win, uri) {
            let top = util.topWindow(win);

            if (top == window)
                this._triggerLoadAutocmd("PageLoadPre", win.document, win.location.href != "null" ? window.location.href : uri);
        }
    },

    _triggerLoadAutocmd: function _triggerLoadAutocmd(name, doc, uri) {
        if (!(uri || doc.location))
            return;

        uri = isObject(uri) ? uri : util.newURI(uri || doc.location.href);
        let args = {
            url: { toString: function () uri.spec, valueOf: function () uri },
            title: doc.title
        };

        if (dactyl.has("tabs")) {
            args.tab = tabs.getContentIndex(doc) + 1;
            args.doc = {
                valueOf: function () doc,
                toString: function () "tabs.getTab(" + (args.tab - 1) + ").linkedBrowser.contentDocument"
            };
        }

        autocommands.trigger(name, args);
    },

    events: {
        DOMContentLoaded: function onDOMContentLoaded(event) {
            let doc = event.originalTarget;
            if (doc instanceof HTMLDocument)
                this._triggerLoadAutocmd("DOMLoad", doc);
        },

        // TODO: see what can be moved to onDOMContentLoaded()
        // event listener which is is called on each page load, even if the
        // page is loaded in a background tab
        load: function onLoad(event) {
            let doc = event.originalTarget;
            if (doc instanceof Document)
                dactyl.initDocument(doc);

            if (doc instanceof HTMLDocument) {
                if (doc.defaultView.frameElement) {
                    // document is part of a frameset

                    // hacky way to get rid of "Transferring data from ..." on sites with frames
                    // when you click on a link inside a frameset, because asyncUpdateUI
                    // is not triggered there (Gecko bug?)
                    this.timeout(function () { statusline.updateUrl(); }, 10);
                }
                else {
                    // code which should happen for all (also background) newly loaded tabs goes here:
                    if (doc != config.browser.contentDocument)
                        dactyl.echomsg({ domains: [util.getHost(doc.location)], message: "Background tab loaded: " + (doc.title || doc.location.href) }, 3);

                    this._triggerLoadAutocmd("PageLoad", doc);
                }
            }
        }
    },

    /**
     * @property {Object} The document loading progress listener.
     */
    progressListener: {
        // XXX: function may later be needed to detect a canceled synchronous openURL()
        onStateChange: util.wrapCallback(function onStateChange(webProgress, request, flags, status) {
            onStateChange.superapply(this, arguments);
            // STATE_IS_DOCUMENT | STATE_IS_WINDOW is important, because we also
            // receive statechange events for loading images and other parts of the web page
            if (flags & (Ci.nsIWebProgressListener.STATE_IS_DOCUMENT | Ci.nsIWebProgressListener.STATE_IS_WINDOW)) {
                dactyl.applyTriggerObserver("browser.stateChange", arguments);
                // This fires when the load event is initiated
                // only thrown for the current tab, not when another tab changes
                if (flags & Ci.nsIWebProgressListener.STATE_START) {
                    while (document.commandDispatcher.focusedWindow == webProgress.DOMWindow
                           && modes.have(modes.INPUT))
                        modes.pop();

                }
                else if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
                    // Workaround for bugs 591425 and 606877, dactyl bug #81
                    config.browser.mCurrentBrowser.collapsed = false;
                    if (!dactyl.focusedElement || dactyl.focusedElement === document.documentElement)
                        dactyl.focusContent();
                }
            }
        }),
        onSecurityChange: util.wrapCallback(function onSecurityChange(webProgress, request, state) {
            onSecurityChange.superapply(this, arguments);
            dactyl.applyTriggerObserver("browser.securityChange", arguments);
        }),
        onStatusChange: util.wrapCallback(function onStatusChange(webProgress, request, status, message) {
            onStatusChange.superapply(this, arguments);
            dactyl.applyTriggerObserver("browser.statusChange", arguments);
        }),
        onProgressChange: util.wrapCallback(function onProgressChange(webProgress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {
            onProgressChange.superapply(this, arguments);
            dactyl.applyTriggerObserver("browser.progressChange", arguments);
        }),
        // happens when the users switches tabs
        onLocationChange: util.wrapCallback(function onLocationChange(webProgress, request, uri) {
            onLocationChange.superapply(this, arguments);

            dactyl.applyTriggerObserver("browser.locationChange", arguments);

            let win = webProgress.DOMWindow;
            if (win && uri) {
                let oldURI = win.document.dactylURI;
                if (win.document.dactylLoadIdx === webProgress.loadedTransIndex
                    || !oldURI || uri.spec.replace(/#.*/, "") !== oldURI.replace(/#.*/, ""))
                    for (let frame in values(buffer.allFrames(win)))
                        frame.document.dactylFocusAllowed = false;
                win.document.dactylURI = uri.spec;
                win.document.dactylLoadIdx = webProgress.loadedTransIndex;
            }

            // Workaround for bugs 591425 and 606877, dactyl bug #81
            let collapse = uri && uri.scheme === "dactyl" && webProgress.isLoadingDocument;
            if (collapse)
                dactyl.focus(document.documentElement);
            config.browser.mCurrentBrowser.collapsed = collapse;

            util.timeout(function () {
                browser._triggerLoadAutocmd("LocationChange",
                                            (win || content).document,
                                            uri);
            });
        }),
        // called at the very end of a page load
        asyncUpdateUI: util.wrapCallback(function asyncUpdateUI() {
            asyncUpdateUI.superapply(this, arguments);
            util.timeout(function () { statusline.updateUrl(); }, 100);
        }),
        setOverLink: util.wrapCallback(function setOverLink(link, b) {
            setOverLink.superapply(this, arguments);
            dactyl.triggerObserver("browser.overLink", link);
        }),
    }
}, {
}, {
    events: function initEvents(dactyl, modules, window) {
        events.listen(config.browser, browser, "events", true);
    },
    commands: function initCommands(dactyl, modules, window) {
        commands.add(["o[pen]"],
            "Open one or more URLs in the current tab",
            function (args) { dactyl.open(args[0] || "about:blank"); },
            {
                completer: function (context) completion.url(context),
                domains: function (args) array.compact(dactyl.parseURLs(args[0] || "").map(
                    function (url) util.getHost(url))),
                literal: 0,
                privateData: true
            });

        commands.add(["redr[aw]"],
            "Redraw the screen",
            function () {
                window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                      .redraw();
                statusline.updateUrl();
                commandline.clear();
            },
            { argCount: "0" });
    },
    mappings: function initMappings(dactyl, modules, window) {
        // opening websites
        mappings.add([modes.NORMAL],
            ["o"], "Open one or more URLs",
            function () { CommandExMode().open("open "); });

        mappings.add([modes.NORMAL], ["O"],
            "Open one or more URLs, based on current location",
            function () { CommandExMode().open("open " + buffer.uri.spec); });

        mappings.add([modes.NORMAL], ["t"],
            "Open one or more URLs in a new tab",
            function () { CommandExMode().open("tabopen "); });

        mappings.add([modes.NORMAL], ["T"],
            "Open one or more URLs in a new tab, based on current location",
            function () { CommandExMode().open("tabopen " + buffer.uri.spec); });

        mappings.add([modes.NORMAL], ["w"],
            "Open one or more URLs in a new window",
            function () { CommandExMode().open("winopen "); });

        mappings.add([modes.NORMAL], ["W"],
            "Open one or more URLs in a new window, based on current location",
            function () { CommandExMode().open("winopen " + buffer.uri.spec); });

        mappings.add([modes.NORMAL], ["~"],
            "Open home directory",
            function () { dactyl.open("~"); });

        mappings.add([modes.NORMAL], ["gh"],
            "Open homepage",
            function () { BrowserHome(); });

        mappings.add([modes.NORMAL], ["gH"],
            "Open homepage in a new tab",
            function () {
                let homepages = gHomeButton.getHomePage();
                dactyl.open(homepages, { from: "homepage", where: dactyl.NEW_TAB });
            });

        mappings.add([modes.MAIN], ["<C-l>"],
            "Redraw the screen",
            function () { ex.redraw(); });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
