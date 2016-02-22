define('extensions/adapt-contrib-assessment/js/adapt-assessmentArticleView',[
    'coreJS/adapt',
    'coreViews/articleView'
], function(Adapt, AdaptArticleView) {

    var AssessmentView = {

        postRender: function() {
            AdaptArticleView.prototype.postRender.call(this);
            if (this.model.isAssessmentEnabled()) {
                this._setupEventListeners();

                var config = this.model.getConfig();
                if (config && config._questions && config._questions._canShowMarking === false) {
                    this.$el.addClass('no-marking');
                }
            }
            this.$el.addClass('assessment');
        },

        _setupEventListeners: function() {
            this.listenTo(Adapt, "assessments:complete", this._onAssessmentComplete);
            this.listenTo(Adapt, "assessments:reset", this._onAssessmentReset);
            this.listenTo(Adapt, "remove", this._onRemove);
        },

        _removeEventListeners: function() {
            this.stopListening(Adapt, "assessments:complete", this._onAssessmentComplete);
            this.stopListening(Adapt, "assessments:reset", this._onAssessmentReset);
        },

        _onAssessmentComplete: function(state, model) {
            if (state.id != this.model.get("_assessment")._id) return;

            console.log("assessment complete", state, model);

        },

        _onAssessmentReset: function(state, model) {
            if (state.id != this.model.get("_assessment")._id) return;

            console.log("assessment reset", state, model);

        },

        _onRemove: function() {
            this._removeEventListeners();
        }

    };

    return AssessmentView;

});

define('extensions/adapt-contrib-assessment/js/adapt-assessmentQuestionBank',['require'],function(require) {
    
    var QuestionBank = function(quizBankid, articleId, numQuestionBlocks, uniqueQuestions) {

        this._id = quizBankid;
        this._articleId = articleId;
        this._numQuestionBlocks = numQuestionBlocks;
        this._uniqueQuestions = uniqueQuestions;
        this.questionBlocks = [];
        this.unUsedQuestionBlocks = undefined;
        this.usedQuestionBlocks = [];

    };

    QuestionBank.prototype = {

        getID: function() {
            return this._id;
        },

        addBlock: function(block) {
            this.questionBlocks.push(block);
        },

        getRandomQuestionBlocks: function() {
            this.checkResetUnunsedBlocks();

            var questionBlocks = [];
            var usedQuestionBlocks = this.usedQuestionBlocks.slice(0);

            for (var i = 0; i < this._numQuestionBlocks; i++) {
                var question = this.getRandomQuestion();
                if (question !== undefined) {
                    questionBlocks.push(question);
                } else {
                    if (usedQuestionBlocks.length === 0) break;
                    var index = Math.floor(Math.random() * (usedQuestionBlocks.length-1));
                    question = usedQuestionBlocks.splice(index,1)[0];
                    questionBlocks.push(question);
                }
            }
                
            return questionBlocks;
        },

        checkResetUnunsedBlocks: function() {
            if (this.unUsedQuestionBlocks !== undefined && this._uniqueQuestions) return;
            
            this.unUsedQuestionBlocks = this.questionBlocks.slice(0);
        },

        getRandomQuestion: function() {
            if (this.unUsedQuestionBlocks !== undefined && this.unUsedQuestionBlocks.length < 1) {
               console.warn("assessment:"+this._articleId+" No more unique questions for _assessment._quizBankID " + this._id);
               return undefined;
            }

            var index = Math.round(Math.random() * (this.unUsedQuestionBlocks.length-1));
            var questionBlock = this.unUsedQuestionBlocks[index];
            this.usedQuestionBlocks.push(questionBlock);

            this.unUsedQuestionBlocks.splice(index, 1);

            return questionBlock;
        }
        
    };

    return QuestionBank;

});
define('extensions/adapt-contrib-assessment/js/adapt-assessmentArticleModel',[
    'coreJS/adapt',
    './adapt-assessmentQuestionBank'
], function(Adapt, QuestionBank) {


    var givenIdCount = 0;
    var assessmentConfigDefaults = {
        "_isEnabled":true,
        "_questions": {
            "_resetType": "soft",
            "_canShowFeedback": false,
            "_canShowMarking": false,
            "_canShowModelAnswer": false
        },
        "_isPercentageBased" : true,
        "_scoreToPass" : 100,
        "_includeInTotalScore": true,
        "_assessmentWeight": 1,
        "_isResetOnRevisit": true,
        "_reloadPageOnReset": true,
        "_attempts": "infinite"
    };

    var AssessmentModel = {

    //Private functions

        _postInitialize: function() {
            if (!this.isAssessmentEnabled()) return;

            var assessmentConfig = this.getConfig();

            _.extend(this, {
                '_currentQuestionComponents': null,
                "_originalChildModels": null,
                "_questionBanks": null,
                "_forceResetOnRevisit": false
            });

            var attemptsLeft;
            switch (assessmentConfig._attempts) {
                case "infinite": case 0: case undefined: case -1: case null:
                     attemptsLeft = "infinite";
                    break;
                default:
                    attemptsLeft = assessmentConfig._attempts;
                    break;
            }


            //if assessment passed required and assessment included in total
            //set attemptsleft to infinite
            var centralAssessmentState = Adapt.assessment.getState();

            if (assessmentConfig._includeInTotalScore &&
                centralAssessmentState.requireAssessmentPassed) {
                attemptsLeft = "infinite";
            }

            this.set({
                '_currentQuestionComponentIds': [],
                '_assessmentCompleteInSession': false,
                '_attemptInProgress': false,
                "_isAssessmentComplete": false,
                '_numberOfQuestionsAnswered': 0,
                '_lastAttemptScoreAsPercent': 0,
                "_attempts": attemptsLeft,
                "_attemptsLeft": attemptsLeft,
                "_attemptsSpent": 0
            });

            this.listenToOnce(Adapt, "app:dataReady", this._onDataReady);
            this.listenTo(Adapt, "remove", this._onRemove);

        },

        init: function() {
            //save original children
            this._originalChildModels = this.getChildren().models;
            //collect all question components
            this._currentQuestionComponents = this.findDescendants("components").where({_isQuestionType: true});
            var currentQuestionsCollection = new Backbone.Collection(this._currentQuestionComponents);
            this.set("_currentQuestionComponentIds", currentQuestionsCollection.pluck("_id"));

            this._setAssessmentOwnershipOnChildrenModels();

        },

        _setAssessmentOwnershipOnChildrenModels: function() {
            //mark all children components as belonging to an assessment
            for (var i = 0, l = this._originalChildModels.length; i < l; i++) {
                var blockModel = this._originalChildModels[i];
                blockModel.set({
                    _isPartOfAssessment: true
                });
                //make sure components are set to _isPartOfAssessment for plp checking
                blockModel.setOnChildren({
                    _isPartOfAssessment: true
                });
            }
        },
        

        _onDataReady: function() {
            //register assessment
            Adapt.assessment.register(this);
        },

        _setupAssessmentData: function(force) {
            var assessmentConfig = this.getConfig();
            var state = this.getState();
            var shouldResetAssessment = (!this.get("_attemptInProgress") && !state.isPass)
                                || force == true;

            var quizModels;
            if (shouldResetAssessment) {
                this.set("_numberOfQuestionsAnswered", 0);
                this.set("_isAssessmentComplete", false);
                this.set("_assessmentCompleteInSession", false);
                this.set("_score", 0);
                this.getChildren().models = this._originalChildModels;
                if(assessmentConfig._banks && 
                        assessmentConfig._banks._isEnabled && 
                        assessmentConfig._banks._split.length > 1) {

                    quizModels = this._setupBankedAssessment();
                } else if(assessmentConfig._randomisation && 
                        assessmentConfig._randomisation._isEnabled) {

                    quizModels = this._setupRandomisedAssessment();
                }
            }

            if (!quizModels) {
                // leave the order as before, completed or not
                quizModels = this.getChildren().models;
            } else if ( quizModels.length === 0 ) {
                quizModels = this.getChildren().models;
                console.warn("assessment: Not enough unique questions to create a fresh assessment, using last selection");
            }

            this.getChildren().models = quizModels;

            this._currentQuestionComponents = this.findDescendants('components').where({_isQuestionType: true});
            var currentQuestionsCollection = new Backbone.Collection(this._currentQuestionComponents);
            this.set("_currentQuestionComponentIds", currentQuestionsCollection.pluck("_id"));

            var shouldResetQuestions = (assessmentConfig._isResetOnRevisit !== false && !state.isPass) 
                                        || force == true;

            if (shouldResetAssessment || shouldResetQuestions) {
                this._resetQuestions();
                this.set("_attemptInProgress", true);
                Adapt.trigger('assessments:reset', this.getState(), this);
            }
            
            if (!state.isComplete) {
                this.set("_attemptInProgress", true);
            }
            
            this._overrideQuestionComponentSettings();
            this._setupQuestionListeners();
            this._checkNumberOfQuestionsAnswered();
            this._updateQuestionsState();

            Adapt.assessment.saveState();

        },

        _setupBankedAssessment: function() {
            var assessmentConfig = this.getConfig();

            this._setupBanks();

            //get random questions from banks
            var questionModels = [];
            for (var bankId in this._questionBanks) {
                var questionBank = this._questionBanks[bankId];
                var questions = questionBank.getRandomQuestionBlocks();
                questionModels = questionModels.concat(questions);
            }

            //if overall question order should be randomized
            if (assessmentConfig._banks._randomisation) {
                questionModels = _.shuffle(questionModels);
            }

            return questionModels;
        },

        _setupBanks: function() {
            var assessmentConfig = this.getConfig();
            var banks = assessmentConfig._banks._split.split(",");

            this._questionBanks = [];

            //build fresh banks
            for (var i = 0, l = banks.length; i < l; i++) {
                var bank = banks[i];
                var bankId = (i+1);
                var questionBank = new QuestionBank(bankId, 
                                                this.get("_id"), 
                                                bank, 
                                                true);

                this._questionBanks[bankId] = questionBank;
            }

            //add blocks to banks
            var children = this.getChildren().models;
            for (var i = 0, l = children.length; i < l; i++) {
                var blockModel = children[i];
                var blockAssessmentConfig = blockModel.get('_assessment');
                var bankId = blockAssessmentConfig._quizBankID;
                this._questionBanks[bankId].addBlock(blockModel);
            }

        },

        _setupRandomisedAssessment: function() {
            var assessmentConfig = this.getConfig();

            var randomisationModel = assessmentConfig._randomisation;
            var blockModels = this.getChildren().models;
            
            var questionModels = _.shuffle(blockModels);

            questionModels = questionModels.slice(0, randomisationModel._blockCount);
            
            return questionModels;
        },

        _overrideQuestionComponentSettings: function() {
            var questionConfig = this.getConfig()._questions;
            var questionComponents = this._currentQuestionComponents;

            var newSettings = {};
            if(questionConfig.hasOwnProperty('_canShowFeedback')) {
                newSettings._canShowFeedback = questionConfig._canShowFeedback;
            }

            if(questionConfig.hasOwnProperty('_canShowModelAnswer')) {
                newSettings._canShowModelAnswer = questionConfig._canShowModelAnswer;
            }

            if(!_.isEmpty(newSettings)) {
                for (var i = 0, l = questionComponents.length; i < l; i++) {
                    questionComponents[i].set(newSettings, { pluginName: "_assessment" });
                }
            }

        },

        _setupQuestionListeners: function() {
            var questionComponents = this._currentQuestionComponents;
            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var question = questionComponents[i];
                if (question.get("_isInteractionComplete")) continue;
                this.listenTo(question, 'change:_isInteractionComplete', this._onQuestionCompleted);
            }
        },

        _checkNumberOfQuestionsAnswered: function() {
            var questionComponents = this._currentQuestionComponents;
            var numberOfQuestionsAnswered = 0;
            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var question = questionComponents[i];
                if (question.get("_isInteractionComplete")) {
                    numberOfQuestionsAnswered++;
                }
            }
            this.set("_numberOfQuestionsAnswered", numberOfQuestionsAnswered);
        },

        _removeQuestionListeners: function() {
            var questionComponents = this._currentQuestionComponents;
            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var question = questionComponents[i];
                this.stopListening(question, 'change:_isInteractionComplete', this._onQuestionCompleted);
            }
        },

        _onQuestionCompleted: function(questionModel, value) {
            if (value === false) return;
            if(!questionModel.get('_isInteractionComplete')) return;

            var numberOfQuestionsAnswered = this.get("_numberOfQuestionsAnswered");
            numberOfQuestionsAnswered++;
            this.set("_numberOfQuestionsAnswered", numberOfQuestionsAnswered);

            this._updateQuestionsState();
            Adapt.assessment.saveState();

            this._checkAssessmentComplete();
        },

        _checkAssessmentComplete: function() {
            var numberOfQuestionsAnswered = this.get("_numberOfQuestionsAnswered");

            var allQuestionsAnswered = numberOfQuestionsAnswered >= this._currentQuestionComponents.length;
            if (!allQuestionsAnswered) return;
            
            this._onAssessmentComplete();
        },

        _onAssessmentComplete: function() {
            var assessmentConfig = this.getConfig();

            this.set("_attemptInProgress", false);
            this._spendAttempt();

            var scoreAsPercent = this._getScoreAsPercent();
            var score = this._getScore();
            var maxScore = this._getMaxScore();

            this.set({
                '_scoreAsPercent': scoreAsPercent,
                '_score': score,
                '_maxScore': maxScore,
                '_lastAttemptScoreAsPercent': scoreAsPercent,
                '_assessmentCompleteInSession': true,
                '_isAssessmentComplete': true
            });

            this._updateQuestionsState();

            this._checkIsPass();

            this._removeQuestionListeners();
            
            Adapt.trigger('assessments:complete', this.getState(), this);
        },

        _updateQuestionsState: function() {
            var questions = [];

            var questionComponents = this._currentQuestionComponents;
            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var questionComponent = questionComponents[i];

                var questionModel = {
                    _id: questionComponent.get("_id"),
                    _isCorrect: questionComponent.get("_isCorrect") === undefined ? null : questionComponent.get("_isCorrect")
                };

                //build array of questions
                questions.push(questionModel);

            }
            
            this.set({
                '_questions': questions
            });
        },

        _checkIsPass: function() {
            var assessmentConfig = this.getConfig();

            var isPercentageBased = assessmentConfig._isPercentageBased;
            var scoreToPass = assessmentConfig._scoreToPass;

            var scoreAsPercent = this.get("_scoreAsPercent");
            var score = this.get("_score");

            var isPass = false;
            if (score && scoreAsPercent) {
                if (isPercentageBased) {
                    isPass = (scoreAsPercent >= scoreToPass) ? true : false;
                } else {
                    isPass = (score >= scoreToPass) ? true : false;
                }
            }

            this.set("_isPass", isPass);
        },

        _isAttemptsLeft: function() {
            var assessmentConfig = this.getConfig();

            var isAttemptsEnabled = assessmentConfig._attempts && assessmentConfig._attempts != "infinite";

            if (!isAttemptsEnabled) return true;

            if (this.get('_attemptsLeft') === 0) return false;
        
            return true;
        },

        _spendAttempt: function() {
            if (!this._isAttemptsLeft()) return false;

            var attemptsSpent = this.get("_attemptsSpent");
            attemptsSpent++;
            this.set("_attemptsSpent", attemptsSpent);

            if (this.get('_attempts') == "infinite") return true;

            var attemptsLeft = this.get('_attemptsLeft');
            attemptsLeft--;
            this.set('_attemptsLeft', attemptsLeft);

            return true;
        },

        _getScore: function() {
            var score = 0;
            var questionComponents = this._currentQuestionComponents;
            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var question = questionComponents[i];
                if (question.get('_isCorrect') && 
                    question.get('_questionWeight')) {
                    score += question.get('_questionWeight');
                }
            }
            return score;
        },
        
        _getMaxScore: function() {
            var maxScore = 0;
            var questionComponents = this._currentQuestionComponents;
            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var question = questionComponents[i];
                if (question.get('_questionWeight')) {
                    maxScore += question.get('_questionWeight');
                }
            }
            return maxScore;
        },
        
        _getScoreAsPercent: function() {
            if (this._getMaxScore() === 0) return 0;
            return Math.round((this._getScore() / this._getMaxScore()) * 100);
        },

        _getLastAttemptScoreAsPercent: function() {
            return this.get('_lastAttemptScoreAsPercent');
        },

        _checkReloadPage: function() {
            if (!this.canResetInPage()) return false;

            var parentId = this.getParent().get("_id");
            var currentLocation = Adapt.location._currentId;

            //check if on assessment page and should rerender page
            if (currentLocation != parentId) return false;
            if (!this.get("_isReady")) return false;

            return true;
        },

        _reloadPage: function() {
            this._forceResetOnRevisit = true;

            Backbone.history.navigate("#/id/"+Adapt.location._currentId, { replace:true, trigger: true });
        },

        _resetQuestions: function() {
            var assessmentConfig = this.getConfig();
            var questionComponents = this._currentQuestionComponents;

            for (var i = 0, l = questionComponents.length; i < l; i++) {
                var question = questionComponents[i];
                question.reset(assessmentConfig._questions._resetType, true);
            }
        },

        _onRemove: function() {
            this._removeQuestionListeners();
        },



        _setCompletionStatus: function() {
            this.set({
                "_isComplete": true,
                "_isInteractionComplete": true,
            });
        },

        _checkIfQuestionsWereRestored: function() {
            if (this.get("_assessmentCompleteInSession")) return;
            if (!this.get("_isAssessmentComplete")) return;

            //fix for courses that do not remember the user selections
            //force assessment to reset if user revisits an assessment page in a new session which is completed
            var wereQuestionsRestored = true;

            var questions = this.get("_questions");
            for (var i = 0, l = questions.length; i < l; i++) {
                var question = questions[i];
                var questionModel = Adapt.findById(question._id);
                if (!questionModel.get("_isSubmitted")) {
                    wereQuestionsRestored = false;
                    break;
                }
            }
        
            if (!wereQuestionsRestored) {
                this.set("_assessmentCompleteInSession", true);
                return true;
            }

            return false;
        },


    //Public Functions

        isAssessmentEnabled: function() {
            if (this.get("_assessment") && 
                this.get("_assessment")._isEnabled) return true;
            return false;
        },

        canResetInPage: function() {
            var assessmentConfig = this.getConfig();
            if (assessmentConfig._reloadPageOnReset === false) return false;
            return true;
        },

        reset: function(force) {
            var assessmentConfig = this.getConfig();

            //check if forcing reset via page revisit or force parameter
            force = this._forceResetOnRevisit || force == true;
            this._forceResetOnRevisit = false;

            var isPageReload = this._checkReloadPage();

            //stop resetting if not complete or not allowed
            if (this.get("_assessmentCompleteInSession") && 
                    !assessmentConfig._isResetOnRevisit && 
                    !isPageReload && 
                    !force) return false;
            
            //check if new session and questions not restored
            force = force || this._checkIfQuestionsWereRestored();
            
            //stop resetting if no attempts left
            if (!this._isAttemptsLeft() && !force) return false;

            if (!isPageReload) {
                //only perform this section when not attempting to reload the page
                this._setupAssessmentData(force);
            } else {
                this._reloadPage();
            }

            return true;
        },

        getSaveState: function() {
            var state = this.getState();
            var questions = state.questions;
            var indexByIdQuestions = _.indexBy(questions, "_id");

            for (var id in indexByIdQuestions) {
                indexByIdQuestions[id] = indexByIdQuestions[id]._isCorrect
            }

            var saveState = [
                state.isComplete ? 1:0,
                state.attemptsSpent,
                state.maxScore,
                state.score,
                state.attemptInProgress ? 1:0,
                indexByIdQuestions
            ];

            return saveState;
        },

        setRestoreState: function(restoreState) {
            var isComplete = restoreState[0] == 1 ? true : false;
            var attempts = this.get("_attempts");
            var attemptsSpent = restoreState[1];
            var maxScore = restoreState[2];
            var score = restoreState[3];
            var attemptInProgress = restoreState[4] == 1 ? true : false;
            var scoreAsPercent;

            var indexByIdQuestions = restoreState[5];

            var blockIds = {};
            for (var id in indexByIdQuestions) {
                var blockId = Adapt.findById(id).get("_parentId");
                blockIds[blockId] = Adapt.findById(blockId);
            }
            var restoredChildrenModels = _.values(blockIds);
            
            if (indexByIdQuestions.length) this.getChildren().models = restoredChildrenModels;


            this.set("_isAssessmentComplete", isComplete);
            this.set("_assessmentCompleteInSession", false);
            this.set("_attemptsSpent", attemptsSpent );
            this.set("_attemptInProgress", attemptInProgress )

            if (attempts == "infinite") this.set("_attemptsLeft", "infinite");
            else this.set("_attemptsLeft" , attempts - attemptsSpent);

            this.set("_maxScore", maxScore || this._getMaxScore());
            this.set("_score", score || 0);

            if (score) {
                scoreAsPercent = Math.floor( score / maxScore  * 100);
            } else {
                scoreAsPercent = 0;
            }
        
            this.set("_scoreAsPercent", scoreAsPercent);
            this.set("_lastAttemptScoreAsPercent", scoreAsPercent)

            
            var questions = [];
            for (var id in indexByIdQuestions) {
                questions.push({
                    _id: id,
                    _isCorrect: indexByIdQuestions[id]
                });
            }

            

            this.set("_questions", questions);
            this._checkIsPass();

        },

        getState: function() {
            //return the current state of the assessment
            //create snapshot of values so as not to create memory leaks
            var assessmentConfig = this.getConfig();

            var state = {
                id: assessmentConfig._id,
                type: "article-assessment",
                pageId: this.getParent().get("_id"),
                isEnabled: assessmentConfig._isEnabled,
                isComplete: this.get("_isAssessmentComplete"),
                isPercentageBased: assessmentConfig._isPercentageBased,
                scoreToPass: assessmentConfig._scoreToPass,
                score: this.get("_score"),
                scoreAsPercent: this.get("_scoreAsPercent"),
                maxScore: this.get("_maxScore"),
                isPass: this.get("_isPass"),
                includeInTotalScore: assessmentConfig._includeInTotalScore,
                assessmentWeight: assessmentConfig._assessmentWeight,
                attempts: this.get("_attempts"),
                attemptsSpent: this.get("_attemptsSpent"),
                attemptsLeft: this.get("_attemptsLeft"),
                attemptInProgress: this.get("_attemptInProgress"),
                lastAttemptScoreAsPercent: this.get('_lastAttemptScoreAsPercent'),
                questions: this.get("_questions"),
                questionModels: new Backbone.Collection(this._currentQuestionComponents)
            };

            return state;
        },

        getConfig: function() {
            var assessmentConfig = this.get("_assessment");

            if (assessmentConfig._id === undefined) {
                assessmentConfig._id = "givenId"+(givenIdCount++);
            } else {
                return assessmentConfig;
            }

            if (!assessmentConfig) {
                assessmentConfig = $.extend(true, {}, assessmentConfigDefaults);
            } else {
                assessmentConfig = $.extend(true, {}, assessmentConfigDefaults, assessmentConfig);
            }

            this.set("_assessment", assessmentConfig);

            return assessmentConfig;
        }
        
    };

    return AssessmentModel;
});

define('extensions/adapt-contrib-assessment/js/assessment',[
    'coreJS/adapt'
], function(Adapt) {

    /*
        Here we setup a registry for all assessments
    */

    var assessmentsConfigDefaults = {
        "_postTotalScoreToLms": true,
        "_isPercentageBased": true,
        "_scoreToPass": 100,
        "_requireAssessmentPassed": false,
        "_isDefaultsLoaded": true
    };

    Adapt.assessment = _.extend({

    //Private functions

        _assessments: _.extend([], {
            _byPageId: {},
            _byAssessmentId: {}
        }),

        initialize: function() {
            this.listenTo(Adapt, "assessments:complete", this._onAssessmentsComplete);
            this.listenTo(Adapt, "router:location", this._checkResetAssessmentsOnRevisit);
        },

        _onAssessmentsComplete: function(state) {
            var assessmentId = state.id;

            state.isComplete = true;

            if (assessmentId === undefined) return;

            if (!this._getStateByAssessmentId(assessmentId)) {
                console.warn("assessments: state was not registered when assessment was created");
            }

            this.saveState();

            this._setPageProgress();

            this._checkAssessmentsComplete();

            //need to add spoor assessment state saving

        },

        _restoreModelState: function(assessmentModel) {

            if (!this._saveStateModel) {
                this._saveStateModel = Adapt.offlineStorage.get("assessment");
            }
            if (this._saveStateModel) {
                var state = assessmentModel.getState();
                if (this._saveStateModel[state.id]) {
                    assessmentModel.setRestoreState(this._saveStateModel[state.id]);
                }
            }

        },

        _checkResetAssessmentsOnRevisit: function(toObject) {
            /* 
                Here we hijack router:location to reorganise the assessment blocks 
                this must happen before trickle listens to block completion
            */
            if (toObject._contentType !== "page") return;

            //initialize assessment on page visit before pageView:preRender (and trickle)
            var pageAssessmentModels = this._getAssessmentByPageId(toObject._currentId);
            if (pageAssessmentModels === undefined) return;

            for (var i = 0, l = pageAssessmentModels.length; i < l; i++) {
                var pageAssessmentModel = pageAssessmentModels[i];
                pageAssessmentModel.reset();
            }

            this._setPageProgress();
        },

        _checkAssessmentsComplete: function() {
            var allAssessmentsComplete = true;
            var assessmentToPostBack = 0;
            var states = this._getStatesByAssessmentId();

            var assessmentStates = [];

            for (var id in states) {
                var state = states[id];
                if (!state.includeInTotalScore) continue;
                if (!state.isComplete) {
                    allAssessmentsComplete = false;
                    break;
                }
                assessmentToPostBack++;
                assessmentStates.push(state);
            }

            if (!allAssessmentsComplete || assessmentToPostBack === 0) return false;

            if (assessmentToPostBack === 1) {
                this._setupSingleAssessmentConfiguration(assessmentStates[0]);
            }

            this._postScoreToLms();

            return true;
        },

        _setupSingleAssessmentConfiguration: function(assessmentState) {
            var assessmentsConfig = Adapt.course.get("_assessment");
            $.extend(true, assessmentsConfig, {
                "_postTotalScoreToLms": assessmentState.includeInTotalScore,
                "_isPercentageBased": assessmentState.isPercentageBased,
                "_scoreToPass": assessmentState.scoreToPass
            });
            Adapt.course.set("_assessment", assessmentsConfig);
        },
        
        _postScoreToLms: function() {
            var assessmentsConfig = this.getConfig();
            if (assessmentsConfig._postTotalScoreToLms === false) return;
            
            var completionState = this.getState();
            //post completion to spoor
            _.defer(function() {
                Adapt.trigger("assessment:complete", completionState);
            });
        },

        _getAssessmentByPageId: function(pageId) {
            return this._assessments._byPageId[pageId];
        },

        _getStateByAssessmentId: function(assessmentId) {
            return this._assessments._byAssessmentId[assessmentId].getState();
        },

        _getStatesByAssessmentId: function() {
            var states = {};
            for (var i = 0, l = this._assessments.length; i < l; i++) {
                var assessmentModel = this._assessments[i];
                var state = assessmentModel.getState();
                states[state.id] = state;
            }
            return states;
        },

        _setPageProgress: function() {
            //set _subProgressTotal and _subProgressComplete on pages that have assessment progress indicator requirements
            
            var requireAssessmentPassed = this.getConfig()._requireAssessmentPassed;

            for (var k in this._assessments._byPageId) {

                var assessments = this._assessments._byPageId[k];

                var assessmentsTotal = assessments.length;
                var assessmentsPassed = 0;

                for (var i = 0, l = assessments.length; i < l; i++) {
                    var assessmentState = assessments[i].getState();

                    var isComplete;

                    if (requireAssessmentPassed) {
                        
                        if (!assessmentState.includeInTotalScore) {
                            isComplete = assessmentState.isComplete;
                        } else if (assessmentState.isPass) {
                            isComplete = assessmentState.isComplete;
                        }

                    } else {

                        isComplete = assessmentState.isComplete;
                    }

                    if ( isComplete ) {
                        assessmentsPassed+=1; 
                    }
                }

                try {
                    var pageModel = Adapt.findById(k);
                    pageModel.set("_subProgressTotal", assessmentsTotal);
                    pageModel.set("_subProgressComplete", assessmentsPassed);
                } catch(e) {

                }

            }
        },


    //Public functions

        register: function(assessmentModel) {
            var state = assessmentModel.getState();
            var assessmentId = state.id;
            var pageId = state.pageId;

            if (this._assessments._byPageId[pageId] === undefined) {
                this._assessments._byPageId[pageId] = [];
            }
            this._assessments._byPageId[pageId].push(assessmentModel);

            if (assessmentId) {
                this._assessments._byAssessmentId[assessmentId] = assessmentModel;
            }

            this._assessments.push(assessmentModel);

            this._restoreModelState(assessmentModel);

            Adapt.trigger("assessments:register", state, assessmentModel);

            this._setPageProgress();
        },

        get: function(id) {
            if (id === undefined) {
                return this._assessments.slice(0);
            } else {
                return this._assessments._byAssessmentId[id];
            }
        },

        saveState: function() {

            this._saveStateModel = {};
            for (var i = 0, assessmentModel; assessmentModel = this._assessments[i++];) {
                var state = assessmentModel.getState();
                this._saveStateModel[state.id] = assessmentModel.getSaveState();
            }

            Adapt.offlineStorage.set("assessment", this._saveStateModel);
        },

        getConfig: function () {
            var assessmentsConfig = Adapt.course.get("_assessment");

            if (assessmentsConfig && assessmentsConfig._isDefaultLoaded) {
                return assessmentsConfig;
            }

            if (assessmentsConfig === undefined) {
                assessmentsConfig = $.extend(true, {}, assessmentsConfigDefaults);
            } else {
                assessmentsConfig = $.extend(true, {}, assessmentsConfigDefaults, assessmentsConfig);
            }

            Adapt.course.set("_assessment", assessmentsConfig);

            return assessmentsConfig;
        },
        
        getState: function() {
            var assessmentsConfig = this.getConfig();

            var score = 0;
            var maxScore = 0;
            var isPass = false;
            var totalAssessments = 0;

            var states = this._getStatesByAssessmentId();

            var assessmentsComplete = 0;

            for (var id in states) {
                var state = states[id];
                if (!state.includeInTotalScore) continue;
                if (state.isComplete) assessmentsComplete++;
                totalAssessments++;
                maxScore += state.maxScore / state.assessmentWeight;
                score += state.score / state.assessmentWeight;
                isPass = isPass === false ? false : state.isPass;
            }

            var isComplete = assessmentsComplete == totalAssessments;
            
            var scoreAsPercent = Math.round((score / maxScore) * 100);

            if ((assessmentsConfig._scoreToPass || 100) && isComplete) {
                if (assessmentsConfig._isPercentageBased || true) {
                    if (scoreAsPercent >= assessmentsConfig._scoreToPass) isPass = true;
                } else {
                    if (score >= assessmentsConfig._scoreToPass) isPass = true;
                }
            }

            return {
                isComplete: isComplete,
                isPercentageBased: assessmentsConfig._isPercentageBased,
                requireAssessmentPassed: assessmentsConfig._requireAssessmentPassed,
                isPass: isPass,
                scoreAsPercent: scoreAsPercent,
                maxScore: maxScore,
                score: score,
                assessmentsComplete: assessmentsComplete,
                assessments: totalAssessments
            };
        },

    }, Backbone.Events);

    Adapt.assessment.initialize();

});

define('extensions/adapt-contrib-assessment/js/adapt-assessmentArticleExtension',[
    'coreJS/adapt',
    'coreViews/articleView',
    'coreModels/articleModel',
    './adapt-assessmentArticleView',
    './adapt-assessmentArticleModel',
    './assessment',
], function(Adapt, ArticleView, ArticleModel, AdaptAssessmentArticleView, AdaptAssessmentArticleModel) {

    /*  
        Here we are extending the articleView and articleModel in Adapt.
        This is to accomodate the assessment functionality on the article.
        The advantage of this method is that the assessment behaviour can utilize all of the predefined article behaviour in both the view and the model.
    */  

    //Extends core/js/views/articleView.js
    var ArticleViewInitialize = ArticleView.prototype.initialize;
    ArticleView.prototype.initialize = function(options) {
        if (this.model.get("_assessment") && this.model.get("_assessment")._isEnabled === true) {
            //extend the articleView with new functionality
            _.extend(this, AdaptAssessmentArticleView);
        }
        //initialize the article in the normal manner
        return ArticleViewInitialize.apply(this, arguments);
    };

    //Extends core/js/models/articleModel.js
    var ArticleModelInitialize = ArticleModel.prototype.initialize;
    ArticleModel.prototype.initialize = function(options) {
        if (this.get("_assessment") && this.get("_assessment")._isEnabled === true) {
            //extend the articleModel with new functionality
            _.extend(this, AdaptAssessmentArticleModel);

            //initialize the article in the normal manner
            var returnValue = ArticleModelInitialize.apply(this, arguments);

            //initialize assessment article
            this._postInitialize();

            return returnValue;
        }

        //initialize the article in the normal manner if no assessment
        return ArticleModelInitialize.apply(this, arguments);
    };

});

define('extensions/adapt-contrib-bookmarking/js/adapt-contrib-bookmarking',[
    'coreJS/adapt'
], function(Adapt) {

    var Bookmarking = _.extend({

        bookmarkLevel: null,
        watchViewIds: null,
        watchViews: [],
        restoredLocationID: null,
        currentLocationID: null,

        initialize: function () {
            this.listenToOnce(Adapt, "router:location", this.onAdaptInitialize);
        },

        onAdaptInitialize: function() {
            if (!this.checkIsEnabled()) return;
            this.setupEventListeners();
            this.checkRestoreLocation();
        },

        checkIsEnabled: function() {
            var courseBookmarkModel = Adapt.course.get('_bookmarking');
            if (!courseBookmarkModel || !courseBookmarkModel._isEnabled) return false;
            if (!Adapt.offlineStorage) return false;
            return true;
        },

        setupEventListeners: function() {
            this._onScroll = _.debounce(_.bind(this.checkLocation, Bookmarking), 1000);
            this.listenTo(Adapt, 'menuView:ready', this.setupMenu);
            this.listenTo(Adapt, 'pageView:preRender', this.setupPage);
        },

        checkRestoreLocation: function() {
            this.restoredLocationID = Adapt.offlineStorage.get("location");

            if (!this.restoredLocationID) return;

            this.listenToOnce(Adapt, "pageView:ready menuView:ready", this.restoreLocation);
        },

        restoreLocation: function() {
            _.defer(_.bind(function() {
                this.stopListening(Adapt, "pageView:ready menuView:ready", this.restoreLocation);

                if (this.restoredLocationID == Adapt.location._currentId) return;

                try {
                    var model = Adapt.findById(this.restoredLocationID);
                } catch (error) {
                    return;
                }

                var locationOnscreen = $("." + this.restoredLocationID).onscreen();
                var isLocationOnscreen = locationOnscreen && (locationOnscreen.percentInview > 0);
                var isLocationFullyInview = locationOnscreen && (locationOnscreen.percentInview === 100);
                if (isLocationOnscreen && isLocationFullyInview) return;

                this.showPrompt();
            }, this));
        },

        showPrompt: function() {
            var courseBookmarkModel = Adapt.course.get('_bookmarking');
            if (!courseBookmarkModel._buttons) {
                courseBookmarkModel._buttons = {
                    yes: "Yes",
                    no: "No"
                };
            }
            if (!courseBookmarkModel._buttons.yes) courseBookmarkModel._buttons.yes = "Yes";
            if (!courseBookmarkModel._buttons.no) courseBookmarkModel._buttons.no = "No";


            this.listenToOnce(Adapt, "bookmarking:continue", this.navigateToPrevious);
            this.listenToOnce(Adapt, "bookmarking:cancel", this.navigateCancel);

            var promptObject = {
                title: courseBookmarkModel.title,
                body: courseBookmarkModel.body,
                _prompts:[
                    {
                        promptText: courseBookmarkModel._buttons.yes,
                        _callbackEvent: "bookmarking:continue",
                    },
                    {
                        promptText: courseBookmarkModel._buttons.no,
                        _callbackEvent: "bookmarking:cancel",
                    }
                ],
                _showIcon: true
            }

            if (Adapt.config.get("_accessibility") && Adapt.config.get("_accessibility")._isActive) {
                $(".loading").show();
                $("#a11y-focuser").focus();
                $("body").attr("aria-hidden", true);
                _.delay(function() {
                    $(".loading").hide();
                    $("body").removeAttr("aria-hidden");
                    Adapt.trigger('notify:prompt', promptObject);
                }, 3000);
            } else {
                Adapt.trigger('notify:prompt', promptObject);
            }
        },

        navigateToPrevious: function() {
            _.defer(_.bind(function() {
                var isSinglePage = Adapt.contentObjects.models.length == 1; 
                Backbone.history.navigate('#/id/' + this.restoredLocationID, {trigger: true, replace: isSinglePage});
            }, this));
            
            this.stopListening(Adapt, "bookmarking:cancel");
        },

        navigateCancel: function() {
            this.stopListening(Adapt, "bookmarking:continue");
        },

        resetLocationID: function () {
            this.setLocationID('');
        },

        setupMenu: function(menuView) {
            var menuModel = menuView.model;
            //set location as menu id unless menu is course, then reset location
            if (menuModel.get("_parentId")) return this.setLocationID(menuModel.get("_id"));
            else this.resetLocationID();
        },
        
        setupPage: function (pageView) {
            var hasPageBookmarkObject = pageView.model.has('_bookmarking');
            var bookmarkModel = (hasPageBookmarkObject) ? pageView.model.get('_bookmarking') : Adapt.course.get('_bookmarking');
            this.bookmarkLevel = bookmarkModel._level;

            if (!bookmarkModel._isEnabled) {
                this.resetLocationID();
                return;
            } else {
                //set location as page id
                this.setLocationID(pageView.model.get('_id'));

                this.watchViewIds = pageView.model.findDescendants(this.bookmarkLevel+"s").pluck("_id");
                this.listenTo(Adapt, this.bookmarkLevel + "View:postRender", this.captureViews);
                this.listenToOnce(Adapt, "remove", this.releaseViews);
                $(window).on("scroll", this._onScroll);
            }
        },

        captureViews: function (view) {
            this.watchViews.push(view);
        },

        setLocationID: function (id) {
            if (!Adapt.offlineStorage) return;
            if (this.currentLocationID == id) return;
            Adapt.offlineStorage.set("location", id);
            this.currentLocationID = id;
        },

        releaseViews: function () {
            this.watchViews.length = 0;
            this.watchViewIds.length = 0;
            this.stopListening(Adapt, 'remove', this.releaseViews);
            this.stopListening(Adapt, this.bookmarkLevel + 'View:postRender', this.captureViews);
            $(window).off("scroll", this._onScroll);
        },

        checkLocation: function() {
            var highestOnscreen = 0;
            var highestOnscreenLocation = "";

            var locationObjects = [];
            for (var i = 0, l = this.watchViews.length; i < l; i++) {
                var view = this.watchViews[i];

                var isViewAPageChild = (_.indexOf(this.watchViewIds, view.model.get("_id")) > -1 );

                if ( !isViewAPageChild ) continue;

                var element = $("." + view.model.get("_id"));
                var isVisible = (element.is(":visible"));

                if (!isVisible) continue;

                var measurements = element.onscreen();
                if (measurements.percentInview > highestOnscreen) {
                    highestOnscreen = measurements.percentInview;
                    highestOnscreenLocation = view.model.get("_id");
                }
            }

            //set location as most inview component
            if (highestOnscreenLocation) this.setLocationID(highestOnscreenLocation);
        }

    }, Backbone.Events)

    Bookmarking.initialize();

});

define('extensions/adapt-contrib-pageLevelProgress/js/completionCalculations',[],function() {
    
    // Calculate completion of a contentObject
    function calculateCompletion(contentObjectModel) {

        var viewType = contentObjectModel.get('_type'),
            nonAssessmentComponentsTotal = 0,
            nonAssessmentComponentsCompleted = 0,
            assessmentComponentsTotal = 0,
            assessmentComponentsCompleted = 0,
            subProgressCompleted = 0,
            subProgressTotal = 0,
            isComplete = contentObjectModel.get("_isComplete") ? 1 : 0;

        // If it's a page
        if (viewType == 'page') {
            var children = contentObjectModel.findDescendants('components').where({'_isAvailable': true, '_isOptional': false});
            var components = getPageLevelProgressEnabledModels(children);

            var nonAssessmentComponents = getNonAssessmentComponents(components);

            nonAssessmentComponentsTotal = nonAssessmentComponents.length | 0,
            nonAssessmentComponentsCompleted = getComponentsCompleted(nonAssessmentComponents).length;

            var assessmentComponents = getAssessmentComponents(components);

            assessmentComponentsTotal = assessmentComponents.length | 0,
            assessmentComponentsCompleted = getComponentsInteractionCompleted(assessmentComponents).length;

            subProgressCompleted = contentObjectModel.get("_subProgressComplete") || 0;
            subProgressTotal = contentObjectModel.get("_subProgressTotal") || 0;

            //add one point extra for page completion to eliminate incomplete pages and full progress bars
            return {
                "subProgressCompleted": subProgressCompleted,
                "subProgressTotal": subProgressTotal,
                "nonAssessmentCompleted": nonAssessmentComponentsCompleted + isComplete,
                "nonAssessmentTotal": nonAssessmentComponentsTotal + 1,
                "assessmentCompleted": assessmentComponentsCompleted + isComplete,
                "assessmentTotal": assessmentComponentsTotal + 1
            };
        }
        // If it's a sub-menu
        else if (viewType == 'menu') {

            _.each(contentObjectModel.get('_children').models, function(contentObject) {
                var completionObject = calculateCompletion(contentObject);
                subProgressCompleted += contentObjectModel.subProgressCompleted || 0;
                subProgressTotal += contentObjectModel.subProgressTotal || 0;
                nonAssessmentComponentsTotal += completionObject.nonAssessmentTotal;
                nonAssessmentComponentsCompleted += completionObject.nonAssessmentCompleted;
                assessmentComponentsTotal += completionObject.assessmentTotal;
                assessmentComponentsCompleted += completionObject.assessmentCompleted;
            });

            return {
                "subProgressCompleted": subProgressCompleted,
                "subProgressTotal" : subProgressTotal,
                "nonAssessmentCompleted": nonAssessmentComponentsCompleted,
                "nonAssessmentTotal": nonAssessmentComponentsTotal,
                "assessmentCompleted": assessmentComponentsCompleted,
                "assessmentTotal": assessmentComponentsTotal,
            };
        }
    }

    function getNonAssessmentComponents(models) {
        return _.filter(models, function(model) {
            return !model.get('_isPartOfAssessment');
        });
    }

    function getAssessmentComponents(models) {
        return _.filter(models, function(model) {
            return model.get('_isPartOfAssessment');
        });
    }

    function getComponentsCompleted(models) {
        return _.filter(models, function(item) {
            return item.get('_isComplete');
        });
    }

    function getComponentsInteractionCompleted(models) {
        return _.filter(models, function(item) {
            return item.get('_isInteractionComplete');
        });
    }

    //Get only those models who were enabled for pageLevelProgress
    function getPageLevelProgressEnabledModels(models) {
        return _.filter(models, function(model) {
            if (model.get('_pageLevelProgress')) {
                return model.get('_pageLevelProgress')._isEnabled;
            }
        });
    }

    return {
    	calculateCompletion: calculateCompletion,
    	getPageLevelProgressEnabledModels: getPageLevelProgressEnabledModels
    };

});
define('extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressMenuView',['require','coreJS/adapt','backbone'],function(require) {

    var Adapt = require('coreJS/adapt');
    var Backbone = require('backbone');

    var PageLevelProgressMenuView = Backbone.View.extend({

        className: 'page-level-progress-menu-item',

        initialize: function() {
            this.listenTo(Adapt, 'remove', this.remove);

            this.ariaText = '';
            if (Adapt.course.get('_globals')._extensions && Adapt.course.get('_globals')._extensions._pageLevelProgress && Adapt.course.get('_globals')._extensions._pageLevelProgress.pageLevelProgressMenuBar) {
                this.ariaText = Adapt.course.get('_globals')._extensions._pageLevelProgress.pageLevelProgressMenuBar + ' ';
            }

            this.render();

            _.defer(_.bind(function() {
                this.updateProgressBar();
            }, this));
        },

        events: {
        },

        render: function() {
            var data = this.model.toJSON();
            _.extend(data, {
                _globals: Adapt.course.get('_globals')
            });
            var template = Handlebars.templates['pageLevelProgressMenu'];

            this.$el.html(template(data));
            return this;
        },

        updateProgressBar: function() {
            if (this.model.get('completedChildrenAsPercentage')) {
                var percentageOfCompleteComponents = this.model.get('completedChildrenAsPercentage');
            } else {
                var percentageOfCompleteComponents = 0;
            }

            // Add percentage of completed components as an aria label attribute
            this.$('.page-level-progress-menu-item-indicator-bar .aria-label').html(this.ariaText + Math.floor(percentageOfCompleteComponents) + '%');

        },

    });

    return PageLevelProgressMenuView;

});

define('extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressView',['require','coreJS/adapt','backbone'],function(require) {

    var Adapt = require('coreJS/adapt');
    var Backbone = require('backbone');

    var PageLevelProgressView = Backbone.View.extend({

        className: 'page-level-progress',

        initialize: function() {
            this.listenTo(Adapt, 'remove', this.remove);
            this.render();
        },

        events: {
            'click .page-level-progress-item button': 'scrollToPageElement'
        },

        scrollToPageElement: function(event) {
            if(event && event.preventDefault) event.preventDefault();
            var currentComponentSelector = '.' + $(event.currentTarget).attr('data-page-level-progress-id');
            var $currentComponent = $(currentComponentSelector);
            Adapt.once('drawer:closed', function() {
                Adapt.scrollTo($currentComponent, { duration:400 });
            });
            Adapt.trigger('drawer:closeDrawer');
        },

        render: function() {
            var components = this.collection.toJSON();
            var data = {
                components: components,
                _globals: Adapt.course.get('_globals')
            };
            var template = Handlebars.templates['pageLevelProgress'];
            this.$el.html(template(data));
            this.$el.a11y_aria_label(true);
            return this;
        }

    });

    return PageLevelProgressView;

});

define('extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressNavigationView',['require','coreJS/adapt','backbone','./completionCalculations','extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressView'],function(require) {

    var Adapt = require('coreJS/adapt');
    var Backbone = require('backbone');
    var completionCalculations = require('./completionCalculations');

    var PageLevelProgressView = require('extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressView');

    var PageLevelProgressNavigationView = Backbone.View.extend({

        tagName: 'button',

        className: 'base page-level-progress-navigation',

        initialize: function() {
            this.listenTo(Adapt, 'remove', this.remove);
            this.listenTo(Adapt, 'router:location', this.updateProgressBar);
            this.listenTo(Adapt, 'pageLevelProgress:update', this.refreshProgressBar);
            this.listenTo(this.collection, 'change:_isInteractionComplete', this.updateProgressBar);
            this.listenTo(this.model, 'change:_isInteractionComplete', this.updateProgressBar);
            this.$el.attr('role', 'button');
            this.ariaText = '';
            
            if (Adapt.course.has('_globals') && Adapt.course.get('_globals')._extensions && Adapt.course.get('_globals')._extensions._pageLevelProgress && Adapt.course.get('_globals')._extensions._pageLevelProgress.pageLevelProgressIndicatorBar) {
                this.ariaText = Adapt.course.get('_globals')._extensions._pageLevelProgress.pageLevelProgressIndicatorBar +  ' ';
            }
            
            this.render();
            
            _.defer(_.bind(function() {
                this.updateProgressBar();
            }, this));
        },

        events: {
            'click': 'onProgressClicked'
        },

        render: function() {
            var components = this.collection.toJSON();
            var data = {
                components: components,
                _globals: Adapt.course.get('_globals')
            };            

            var template = Handlebars.templates['pageLevelProgressNavigation'];
            $('.navigation-drawer-toggle-button').after(this.$el.html(template(data)));
            return this;
        },
        
        refreshProgressBar: function() {
            var currentPageComponents = this.model.findDescendants('components').where({'_isAvailable': true});
            var enabledProgressComponents = completionCalculations.getPageLevelProgressEnabledModels(currentPageComponents);
            
            this.collection = new Backbone.Collection(enabledProgressComponents);
            this.updateProgressBar();
        },

        updateProgressBar: function() {
            var completionObject = completionCalculations.calculateCompletion(this.model);
            
            //take all assessment, nonassessment and subprogress into percentage
            //this allows the user to see if assessments have been passed, if assessment components can be retaken, and all other component's completion
            
            var completed = completionObject.nonAssessmentCompleted + completionObject.assessmentCompleted + completionObject.subProgressCompleted;
            var total  = completionObject.nonAssessmentTotal + completionObject.assessmentTotal + completionObject.subProgressTotal;

            var percentageComplete = Math.floor((completed / total)*100);


            this.$('.page-level-progress-navigation-bar').css('width', percentageComplete + '%');

            // Add percentage of completed components as an aria label attribute
            this.$el.attr('aria-label', this.ariaText +  percentageComplete + '%');

            // Set percentage of completed components to model attribute to update progress on MenuView
            this.model.set('completedChildrenAsPercentage', percentageComplete);
        },

        onProgressClicked: function(event) {
            if(event && event.preventDefault) event.preventDefault();
            Adapt.drawer.triggerCustomView(new PageLevelProgressView({collection: this.collection}).$el, false);
        }

    });

    return PageLevelProgressNavigationView;

});

define('extensions/adapt-contrib-pageLevelProgress/js/adapt-contrib-pageLevelProgress',['require','coreJS/adapt','backbone','./completionCalculations','extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressMenuView','extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressNavigationView'],function(require) {

    var Adapt = require('coreJS/adapt');
    var Backbone = require('backbone');
    var completionCalculations = require('./completionCalculations');

    var PageLevelProgressMenuView = require('extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressMenuView');
    var PageLevelProgressNavigationView = require('extensions/adapt-contrib-pageLevelProgress/js/PageLevelProgressNavigationView');

    function setupPageLevelProgress(pageModel, enabledProgressComponents) {

        new PageLevelProgressNavigationView({model: pageModel, collection:  new Backbone.Collection(enabledProgressComponents) });

    }

    // This should add/update progress on menuView
    Adapt.on('menuView:postRender', function(view) {

        if (view.model.get('_id') == Adapt.location._currentId) return;

        // do not proceed until pageLevelProgress enabled on course.json
        if (!Adapt.course.get('_pageLevelProgress') || !Adapt.course.get('_pageLevelProgress')._isEnabled) {
            return;
        }

        var pageLevelProgress = view.model.get('_pageLevelProgress');
        var viewType = view.model.get('_type');

        // Progress bar should not render for course viewType
        if (viewType == 'course') return;

        if (pageLevelProgress && pageLevelProgress._isEnabled) {

            var completionObject = completionCalculations.calculateCompletion(view.model);

            //take all non-assessment components and subprogress info into the percentage
            //this allows the user to see if the assessments are passed (subprogress) and all other components are complete
            
            var completed = completionObject.nonAssessmentCompleted + completionObject.subProgressCompleted;
            var total = completionObject.nonAssessmentTotal + completionObject.subProgressTotal;

            var percentageComplete = Math.floor((completed / total)*100);
            
            view.model.set('completedChildrenAsPercentage', percentageComplete);
            view.$el.find('.menu-item-inner').append(new PageLevelProgressMenuView({model: view.model}).$el);

        }

    });

    // This should add/update progress on page navigation bar
    Adapt.on('router:page', function(pageModel) {

        // do not proceed until pageLevelProgress enabled on course.json
        if (!Adapt.course.get('_pageLevelProgress') || !Adapt.course.get('_pageLevelProgress')._isEnabled) {
            return;
        }

        var currentPageComponents = pageModel.findDescendants('components').where({'_isAvailable': true});
        var enabledProgressComponents = completionCalculations.getPageLevelProgressEnabledModels(currentPageComponents);

        if (enabledProgressComponents.length > 0) {
            setupPageLevelProgress(pageModel, enabledProgressComponents);
        }

    });

});

define('extensions/adapt-contrib-resources/js/adapt-contrib-resourcesView',['require','backbone','coreJS/adapt'],function(require) {

    var Backbone = require('backbone');
    var Adapt = require('coreJS/adapt');

    var ResourcesView = Backbone.View.extend({

        className: "resources",

        initialize: function() {
            this.listenTo(Adapt, 'remove', this.remove);
            this.render();
        },

        events: {
            'click .resources-filter button': 'onFilterClicked',
            'click .resources-item-container button': 'onResourceClicked'
        },

        render: function() {
            var collectionData = this.collection.toJSON();
            var modelData = this.model.toJSON();
            var template = Handlebars.templates["resources"];
            this.$el.html(template({model: modelData, resources:collectionData, _globals: Adapt.course.get('_globals')}));
            _.defer(_.bind(this.postRender, this));
            return this;
        },

        postRender: function() {
            this.listenTo(Adapt, 'drawer:triggerCustomView', this.remove);
        },

        onFilterClicked: function(event) {
            event.preventDefault();
            var $currentTarget = $(event.currentTarget);
            this.$('.resources-filter button').removeClass('selected');
            var filter = $currentTarget.addClass('selected').attr('data-filter');
            var items = [];

            if (filter === 'all') {
                items = this.$('.resources-item').removeClass('display-none');
            } else {
                this.$('.resources-item').removeClass('display-none').not("." + filter).addClass('display-none');
                items = this.$('.resources-item.' + filter);
            }

            if (items.length === 0) return;
            $(items[0]).a11y_focus();
        },

        onResourceClicked: function(event) {
            window.open($(event.currentTarget).data("href"));
        }
    });

    return ResourcesView;
})
;
define('extensions/adapt-contrib-resources/js/adapt-contrib-resourcesHelpers',['require','handlebars'],function(require) {

	var Handlebars = require('handlebars');

	Handlebars.registerHelper('if_collection_contains', function(collection, attribute, value, block) {
		var makeBlockVisible = false;

		_.each(collection, function(resource) {
			if (resource[attribute] === value) {
				makeBlockVisible = true;
			}
		});
		if(makeBlockVisible) {
            return block.fn(this);
        } else {
            return block.inverse();
        }
    });

    Handlebars.registerHelper('if_collection_contains_only_one_item', function(collection, attribute, block) {
		var attributeCount = [];

		_.each(collection, function(resource) {
			var resourceAttribute = resource[attribute];
			if (_.indexOf(attributeCount, resourceAttribute) === -1) {
				attributeCount.push(resourceAttribute);
			}
		});

		if (attributeCount.length <= 1) {
			return block.fn(this);
		} else {
			return block.inverse(this);
		}

    });

    Handlebars.registerHelper('return_column_layout_from_collection_length', function(collection, attribute) {
		var attributeCount = [];

		_.each(collection, function(resource) {
			var resourceAttribute = resource[attribute];
			if (_.indexOf(attributeCount, resourceAttribute) === -1) {
				attributeCount.push(resourceAttribute);
			}
		});

		return (attributeCount.length + 1);

    });

})
	;
define('extensions/adapt-contrib-resources/js/adapt-contrib-resources',['require','coreJS/adapt','backbone','extensions/adapt-contrib-resources/js/adapt-contrib-resourcesView','extensions/adapt-contrib-resources/js/adapt-contrib-resourcesHelpers'],function(require) {

	var Adapt = require('coreJS/adapt');
	var Backbone = require('backbone');
	var ResourcesView = require('extensions/adapt-contrib-resources/js/adapt-contrib-resourcesView');
	var ResourcesHelpers = require('extensions/adapt-contrib-resources/js/adapt-contrib-resourcesHelpers');

	function setupResources(resourcesModel, resourcesItems) {

		var resourcesCollection = new Backbone.Collection(resourcesItems);
		var resourcesModel = new Backbone.Model(resourcesModel);

		Adapt.on('resources:showResources', function() {
			Adapt.drawer.triggerCustomView(new ResourcesView({
				model: resourcesModel, 
				collection: resourcesCollection
			}).$el);
		});
	
	}

	Adapt.once('app:dataReady', function() {

		var courseResources = Adapt.course.get('_resources');

		if (courseResources) {
			var drawerObject = {
		        title: courseResources.title,
		        description: courseResources.description,
		        className: 'resources-drawer'
		    };
		    // Syntax for adding a Drawer item
		    // Adapt.drawer.addItem([object], [callbackEvent]);
		    Adapt.drawer.addItem(drawerObject, 'resources:showResources');
		} else {
			return console.log('Sorry, no resources object is set on the course.json file');
		}

		setupResources(courseResources, courseResources._resourcesItems);

	});

});
/*global console*/

/* ===========================================================

pipwerks SCORM Wrapper for JavaScript
v1.1.20150614

Created by Philip Hutchison, January 2008-2014
https://github.com/pipwerks/scorm-api-wrapper

Copyright (c) Philip Hutchison
MIT-style license: http://pipwerks.mit-license.org/

This wrapper works with both SCORM 1.2 and SCORM 2004.

Inspired by APIWrapper.js, created by the ADL and
Concurrent Technologies Corporation, distributed by
the ADL (http://www.adlnet.gov/scorm).

SCORM.API.find() and SCORM.API.get() functions based
on ADL code, modified by Mike Rustici
(http://www.scorm.com/resources/apifinder/SCORMAPIFinder.htm),
further modified by Philip Hutchison

=============================================================== */


var pipwerks = {};                                  //pipwerks 'namespace' helps ensure no conflicts with possible other "SCORM" variables
pipwerks.UTILS = {};                                //For holding UTILS functions
pipwerks.debug = { isActive: true };                //Enable (true) or disable (false) for debug mode

pipwerks.SCORM = {                                  //Define the SCORM object
    version:    null,                               //Store SCORM version.
    handleCompletionStatus: true,                   //Whether or not the wrapper should automatically handle the initial completion status
    handleExitMode: true,                           //Whether or not the wrapper should automatically handle the exit mode
    API:        { handle: null,
                  isFound: false },                 //Create API child object
    connection: { isActive: false },                //Create connection child object
    data:       { completionStatus: null,
                  exitStatus: null },               //Create data child object
    debug:      {}                                  //Create debug child object
};



/* --------------------------------------------------------------------------------
   pipwerks.SCORM.isAvailable
   A simple function to allow Flash ExternalInterface to confirm
   presence of JS wrapper before attempting any LMS communication.

   Parameters: none
   Returns:    Boolean (true)
----------------------------------------------------------------------------------- */

pipwerks.SCORM.isAvailable = function(){
    return true;
};



// ------------------------------------------------------------------------- //
// --- SCORM.API functions ------------------------------------------------- //
// ------------------------------------------------------------------------- //


/* -------------------------------------------------------------------------
   pipwerks.SCORM.API.find(window)
   Looks for an object named API in parent and opener windows

   Parameters: window (the browser window object).
   Returns:    Object if API is found, null if no API found
---------------------------------------------------------------------------- */

pipwerks.SCORM.API.find = function(win){

    var API = null,
        findAttempts = 0,
        findAttemptLimit = 500,
        traceMsgPrefix = "SCORM.API.find",
        trace = pipwerks.UTILS.trace,
        scorm = pipwerks.SCORM;

    while ((!win.API && !win.API_1484_11) &&
           (win.parent) &&
           (win.parent != win) &&
           (findAttempts <= findAttemptLimit)){

                findAttempts++;
                win = win.parent;

    }

    //If SCORM version is specified by user, look for specific API
    if(scorm.version){

        switch(scorm.version){

            case "2004" :

                if(win.API_1484_11){

                    API = win.API_1484_11;

                } else {

                    trace(traceMsgPrefix +": SCORM version 2004 was specified by user, but API_1484_11 cannot be found.");

                }

                break;

            case "1.2" :

                if(win.API){

                    API = win.API;

                } else {

                    trace(traceMsgPrefix +": SCORM version 1.2 was specified by user, but API cannot be found.");

                }

                break;

        }

    } else {                             //If SCORM version not specified by user, look for APIs

        if(win.API_1484_11) {            //SCORM 2004-specific API.

            scorm.version = "2004";      //Set version
            API = win.API_1484_11;

        } else if(win.API){              //SCORM 1.2-specific API

            scorm.version = "1.2";       //Set version
            API = win.API;

        }

    }

    if(API){

        trace(traceMsgPrefix +": API found. Version: " +scorm.version);
        trace("API: " +API);

    } else {

        trace(traceMsgPrefix +": Error finding API. \nFind attempts: " +findAttempts +". \nFind attempt limit: " +findAttemptLimit);

    }

    return API;

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.API.get()
   Looks for an object named API, first in the current window's frame
   hierarchy and then, if necessary, in the current window's opener window
   hierarchy (if there is an opener window).

   Parameters:  None.
   Returns:     Object if API found, null if no API found
---------------------------------------------------------------------------- */

pipwerks.SCORM.API.get = function(){

    var API = null,
        win = window,
        scorm = pipwerks.SCORM,
        find = scorm.API.find,
        trace = pipwerks.UTILS.trace;

    API = find(win);

    if(!API && win.parent && win.parent != win){
        API = find(win.parent);
    }

    if(!API && win.top && win.top.opener){
        API = find(win.top.opener);
    }

    //Special handling for Plateau
    //Thanks to Joseph Venditti for the patch
    if(!API && win.top && win.top.opener && win.top.opener.document) {
        API = find(win.top.opener.document);
    }

    if(API){
        scorm.API.isFound = true;
    } else {
        trace("API.get failed: Can't find the API!");
    }

    return API;

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.API.getHandle()
   Returns the handle to API object if it was previously set

   Parameters:  None.
   Returns:     Object (the pipwerks.SCORM.API.handle variable).
---------------------------------------------------------------------------- */

pipwerks.SCORM.API.getHandle = function() {

    var API = pipwerks.SCORM.API;

    if(!API.handle && !API.isFound){

        API.handle = API.get();

    }

    return API.handle;

};



// ------------------------------------------------------------------------- //
// --- pipwerks.SCORM.connection functions --------------------------------- //
// ------------------------------------------------------------------------- //


/* -------------------------------------------------------------------------
   pipwerks.SCORM.connection.initialize()
   Tells the LMS to initiate the communication session.

   Parameters:  None
   Returns:     Boolean
---------------------------------------------------------------------------- */

pipwerks.SCORM.connection.initialize = function(){

    var success = false,
        scorm = pipwerks.SCORM,
        completionStatus = scorm.data.completionStatus,
        trace = pipwerks.UTILS.trace,
        makeBoolean = pipwerks.UTILS.StringToBoolean,
        debug = scorm.debug,
        traceMsgPrefix = "SCORM.connection.initialize ";

    trace("connection.initialize called.");

    if(!scorm.connection.isActive){

        var API = scorm.API.getHandle(),
            errorCode = 0;

        if(API){

            switch(scorm.version){
                case "1.2" : success = makeBoolean(API.LMSInitialize("")); break;
                case "2004": success = makeBoolean(API.Initialize("")); break;
            }

            if(success){

                //Double-check that connection is active and working before returning 'true' boolean
                errorCode = debug.getCode();

                if(errorCode !== null && errorCode === 0){

                    scorm.connection.isActive = true;

                    if(scorm.handleCompletionStatus){

                        //Automatically set new launches to incomplete
                        completionStatus = scorm.status("get");

                        if(completionStatus){

                            switch(completionStatus){

                                //Both SCORM 1.2 and 2004
                                case "not attempted": scorm.status("set", "incomplete"); break;

                                //SCORM 2004 only
                                case "unknown" : scorm.status("set", "incomplete"); break;

                                //Additional options, presented here in case you'd like to use them
                                //case "completed"  : break;
                                //case "incomplete" : break;
                                //case "passed"     : break;    //SCORM 1.2 only
                                //case "failed"     : break;    //SCORM 1.2 only
                                //case "browsed"    : break;    //SCORM 1.2 only

                            }

                            //Commit changes
                            scorm.save();

                        }

                    }

                } else {

                    success = false;
                    trace(traceMsgPrefix +"failed. \nError code: " +errorCode +" \nError info: " +debug.getInfo(errorCode));

                }

            } else {

                errorCode = debug.getCode();

                if(errorCode !== null && errorCode !== 0){

                    trace(traceMsgPrefix +"failed. \nError code: " +errorCode +" \nError info: " +debug.getInfo(errorCode));

                } else {

                    trace(traceMsgPrefix +"failed: No response from server.");

                }
            }

        } else {

            trace(traceMsgPrefix +"failed: API is null.");

        }

    } else {

          trace(traceMsgPrefix +"aborted: Connection already active.");

     }

     return success;

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.connection.terminate()
   Tells the LMS to terminate the communication session

   Parameters:  None
   Returns:     Boolean
---------------------------------------------------------------------------- */

pipwerks.SCORM.connection.terminate = function(){

    var success = false,
        scorm = pipwerks.SCORM,
        exitStatus = scorm.data.exitStatus,
        completionStatus = scorm.data.completionStatus,
        trace = pipwerks.UTILS.trace,
        makeBoolean = pipwerks.UTILS.StringToBoolean,
        debug = scorm.debug,
        traceMsgPrefix = "SCORM.connection.terminate ";


    if(scorm.connection.isActive){

        var API = scorm.API.getHandle(),
            errorCode = 0;

        if(API){

             if(scorm.handleExitMode && !exitStatus){

                if(completionStatus !== "completed" && completionStatus !== "passed"){

                    switch(scorm.version){
                        case "1.2" : success = scorm.set("cmi.core.exit", "suspend"); break;
                        case "2004": success = scorm.set("cmi.exit", "suspend"); break;
                    }

                } else {

                    switch(scorm.version){
                        case "1.2" : success = scorm.set("cmi.core.exit", "logout"); break;
                        case "2004": success = scorm.set("cmi.exit", "normal"); break;
                    }

                }

            }

            //Ensure we persist the data
            success = scorm.save();

            if(success){
     
                switch(scorm.version){
                    case "1.2" : success = makeBoolean(API.LMSFinish("")); break;
                    case "2004": success = makeBoolean(API.Terminate("")); break;
                }
                   
                if(success){
                        
                    scorm.connection.isActive = false;
                   
                } else {
                        
                    errorCode = debug.getCode();
                    trace(traceMsgPrefix +"failed. \nError code: " +errorCode +" \nError info: " +debug.getInfo(errorCode));
       
                }
                
            }

        } else {

            trace(traceMsgPrefix +"failed: API is null.");

        }

    } else {

        trace(traceMsgPrefix +"aborted: Connection already terminated.");

    }

    return success;

};



// ------------------------------------------------------------------------- //
// --- pipwerks.SCORM.data functions --------------------------------------- //
// ------------------------------------------------------------------------- //


/* -------------------------------------------------------------------------
   pipwerks.SCORM.data.get(parameter)
   Requests information from the LMS.

   Parameter: parameter (string, name of the SCORM data model element)
   Returns:   string (the value of the specified data model element)
---------------------------------------------------------------------------- */

pipwerks.SCORM.data.get = function(parameter){

    var value = null,
        scorm = pipwerks.SCORM,
        trace = pipwerks.UTILS.trace,
        debug = scorm.debug,
        traceMsgPrefix = "SCORM.data.get(" +parameter +") ";

    if(scorm.connection.isActive){

        var API = scorm.API.getHandle(),
            errorCode = 0;

          if(API){

            switch(scorm.version){
                case "1.2" : value = API.LMSGetValue(parameter); break;
                case "2004": value = API.GetValue(parameter); break;
            }

            errorCode = debug.getCode();

            //GetValue returns an empty string on errors
            //If value is an empty string, check errorCode to make sure there are no errors
            if(value !== "" || errorCode === 0){

                //GetValue is successful.  
                //If parameter is lesson_status/completion_status or exit status, let's
                //grab the value and cache it so we can check it during connection.terminate()
                switch(parameter){

                    case "cmi.core.lesson_status":
                    case "cmi.completion_status" : scorm.data.completionStatus = value; break;

                    case "cmi.core.exit":
                    case "cmi.exit"     : scorm.data.exitStatus = value; break;

                }

            } else {

                trace(traceMsgPrefix +"failed. \nError code: " +errorCode +"\nError info: " +debug.getInfo(errorCode));

            }

        } else {

            trace(traceMsgPrefix +"failed: API is null.");

        }

    } else {

        trace(traceMsgPrefix +"failed: API connection is inactive.");

    }

    trace(traceMsgPrefix +" value: " +value);

    return String(value);

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.data.set()
   Tells the LMS to assign the value to the named data model element.
   Also stores the SCO's completion status in a variable named
   pipwerks.SCORM.data.completionStatus. This variable is checked whenever
   pipwerks.SCORM.connection.terminate() is invoked.

   Parameters: parameter (string). The data model element
               value (string). The value for the data model element
   Returns:    Boolean
---------------------------------------------------------------------------- */

pipwerks.SCORM.data.set = function(parameter, value){

    var success = false,
        scorm = pipwerks.SCORM,
        trace = pipwerks.UTILS.trace,
        makeBoolean = pipwerks.UTILS.StringToBoolean,
        debug = scorm.debug,
        traceMsgPrefix = "SCORM.data.set(" +parameter +") ";


    if(scorm.connection.isActive){

        var API = scorm.API.getHandle(),
            errorCode = 0;

        if(API){

            switch(scorm.version){
                case "1.2" : success = makeBoolean(API.LMSSetValue(parameter, value)); break;
                case "2004": success = makeBoolean(API.SetValue(parameter, value)); break;
            }

            if(success){

                if(parameter === "cmi.core.lesson_status" || parameter === "cmi.completion_status"){

                    scorm.data.completionStatus = value;

                }

            } else {

                errorCode = debug.getCode();

                trace(traceMsgPrefix +"failed. \nError code: " +errorCode +". \nError info: " +debug.getInfo(errorCode));

            }

        } else {

            trace(traceMsgPrefix +"failed: API is null.");

        }

    } else {

        trace(traceMsgPrefix +"failed: API connection is inactive.");

    }

    return success;

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.data.save()
   Instructs the LMS to persist all data to this point in the session

   Parameters: None
   Returns:    Boolean
---------------------------------------------------------------------------- */

pipwerks.SCORM.data.save = function(){

    var success = false,
        scorm = pipwerks.SCORM,
        trace = pipwerks.UTILS.trace,
        makeBoolean = pipwerks.UTILS.StringToBoolean,
        traceMsgPrefix = "SCORM.data.save failed";


    if(scorm.connection.isActive){

        var API = scorm.API.getHandle();

        if(API){

            switch(scorm.version){
                case "1.2" : success = makeBoolean(API.LMSCommit("")); break;
                case "2004": success = makeBoolean(API.Commit("")); break;
            }

        } else {

            trace(traceMsgPrefix +": API is null.");

        }

    } else {

        trace(traceMsgPrefix +": API connection is inactive.");

    }

    return success;

};


pipwerks.SCORM.status = function (action, status){

    var success = false,
        scorm = pipwerks.SCORM,
        trace = pipwerks.UTILS.trace,
        traceMsgPrefix = "SCORM.getStatus failed",
        cmi = "";

    if(action !== null){

        switch(scorm.version){
            case "1.2" : cmi = "cmi.core.lesson_status"; break;
            case "2004": cmi = "cmi.completion_status"; break;
        }

        switch(action){

            case "get": success = scorm.data.get(cmi); break;

            case "set": if(status !== null){

                            success = scorm.data.set(cmi, status);

                        } else {

                            success = false;
                            trace(traceMsgPrefix +": status was not specified.");

                        }

                        break;

            default      : success = false;
                        trace(traceMsgPrefix +": no valid action was specified.");

        }

    } else {

        trace(traceMsgPrefix +": action was not specified.");

    }

    return success;

};


// ------------------------------------------------------------------------- //
// --- pipwerks.SCORM.debug functions -------------------------------------- //
// ------------------------------------------------------------------------- //


/* -------------------------------------------------------------------------
   pipwerks.SCORM.debug.getCode
   Requests the error code for the current error state from the LMS

   Parameters: None
   Returns:    Integer (the last error code).
---------------------------------------------------------------------------- */

pipwerks.SCORM.debug.getCode = function(){

    var scorm = pipwerks.SCORM,
        API = scorm.API.getHandle(),
        trace = pipwerks.UTILS.trace,
        code = 0;

    if(API){

        switch(scorm.version){
            case "1.2" : code = parseInt(API.LMSGetLastError(), 10); break;
            case "2004": code = parseInt(API.GetLastError(), 10); break;
        }

    } else {

        trace("SCORM.debug.getCode failed: API is null.");

    }

    return code;

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.debug.getInfo()
   "Used by a SCO to request the textual description for the error code
   specified by the value of [errorCode]."

   Parameters: errorCode (integer).
   Returns:    String.
----------------------------------------------------------------------------- */

pipwerks.SCORM.debug.getInfo = function(errorCode){

    var scorm = pipwerks.SCORM,
        API = scorm.API.getHandle(),
        trace = pipwerks.UTILS.trace,
        result = "";


    if(API){

        switch(scorm.version){
            case "1.2" : result = API.LMSGetErrorString(errorCode.toString()); break;
            case "2004": result = API.GetErrorString(errorCode.toString()); break;
        }

    } else {

        trace("SCORM.debug.getInfo failed: API is null.");

    }

    return String(result);

};


/* -------------------------------------------------------------------------
   pipwerks.SCORM.debug.getDiagnosticInfo
   "Exists for LMS specific use. It allows the LMS to define additional
   diagnostic information through the API Instance."

   Parameters: errorCode (integer).
   Returns:    String (Additional diagnostic information about the given error code).
---------------------------------------------------------------------------- */

pipwerks.SCORM.debug.getDiagnosticInfo = function(errorCode){

    var scorm = pipwerks.SCORM,
        API = scorm.API.getHandle(),
        trace = pipwerks.UTILS.trace,
        result = "";

    if(API){

        switch(scorm.version){
            case "1.2" : result = API.LMSGetDiagnostic(errorCode); break;
            case "2004": result = API.GetDiagnostic(errorCode); break;
        }

    } else {

        trace("SCORM.debug.getDiagnosticInfo failed: API is null.");

    }

    return String(result);

};


// ------------------------------------------------------------------------- //
// --- Shortcuts! ---------------------------------------------------------- //
// ------------------------------------------------------------------------- //

// Because nobody likes typing verbose code.

pipwerks.SCORM.init = pipwerks.SCORM.connection.initialize;
pipwerks.SCORM.get  = pipwerks.SCORM.data.get;
pipwerks.SCORM.set  = pipwerks.SCORM.data.set;
pipwerks.SCORM.save = pipwerks.SCORM.data.save;
pipwerks.SCORM.quit = pipwerks.SCORM.connection.terminate;



// ------------------------------------------------------------------------- //
// --- pipwerks.UTILS functions -------------------------------------------- //
// ------------------------------------------------------------------------- //


/* -------------------------------------------------------------------------
   pipwerks.UTILS.StringToBoolean()
   Converts 'boolean strings' into actual valid booleans.

   (Most values returned from the API are the strings "true" and "false".)

   Parameters: String
   Returns:    Boolean
---------------------------------------------------------------------------- */

pipwerks.UTILS.StringToBoolean = function(value){
    var t = typeof value;
    switch(t){
       //typeof new String("true") === "object", so handle objects as string via fall-through. 
       //See https://github.com/pipwerks/scorm-api-wrapper/issues/3
       case "object":  
       case "string": return (/(true|1)/i).test(value);
       case "number": return !!value;
       case "boolean": return value;
       case "undefined": return null;
       default: return false;
    }
};



/* -------------------------------------------------------------------------
   pipwerks.UTILS.trace()
   Displays error messages when in debug mode.

   Parameters: msg (string)
   Return:     None
---------------------------------------------------------------------------- */

pipwerks.UTILS.trace = function(msg){

     if(pipwerks.debug.isActive){

        if(window.console && window.console.log){
            window.console.log(msg);
        } else {
            //alert(msg);
        }

     }
};

define("extensions/adapt-contrib-spoor/js/scorm/API", function(){});

define ('extensions/adapt-contrib-spoor/js/scorm/wrapper',['require'],function(require) {

	/*
		IMPORTANT: This wrapper uses the Pipwerks SCORM wrapper and should therefore support both SCORM 1.2 and 2004. Ensure any changes support both versions.
	*/

	var ScormWrapper = function() {
		/* configuration */
		this.setCompletedWhenFailed = true;// this only applies to SCORM 2004
		/**
		 * whether to commit each time there's a change to lesson_status or not
		 */
		this.commitOnStatusChange = true;
		/**
		 * how frequently (in minutes) to commit automatically. set to 0 to disable.
		 */
		this.timedCommitFrequency = 10;
		/**
		 * how many times to retry if a commit fails
		 */
		this.maxCommitRetries = 5;
		/**
		 * time (in milliseconds) to wait between retries
		 */
		this.commitRetryDelay = 1000;
		
		/**
		 * prevents commit from being called if there's already a 'commit retry' pending.
		 */
		this.commitRetryPending = false;
		/**
		 * how many times we've done a 'commit retry'
		 */
		this.commitRetries = 0;
		/**
		 * not currently used - but you could include in an error message to show when data was last saved
		 */
		this.lastCommitSuccessTime = null;
		
		this.timedCommitIntervalID = null;
		this.retryCommitTimeoutID = null;
		this.logOutputWin = null;
		this.startTime = null;
		this.endTime = null;
		
		this.lmsConnected = false;
		this.finishCalled = false;
		
		this.logger = Logger.getInstance();
		this.scorm = pipwerks.SCORM;

		this.suppressErrors = false;
        
		if (window.__debug)
			this.showDebugWindow();
	};

	// static
	ScormWrapper.instance = null;

	/******************************* public methods *******************************/

	// static
	ScormWrapper.getInstance = function() {
		if (ScormWrapper.instance === null)
			ScormWrapper.instance = new ScormWrapper();
		
		return ScormWrapper.instance;
	};

	ScormWrapper.prototype.getVersion = function() {
		return this.scorm.version;
	};

	ScormWrapper.prototype.setVersion = function(value) {
		this.scorm.version = value;
		/**
		 * stop the pipwerks code from setting cmi.core.exit to suspend/logout when targeting SCORM 1.2.
		 * there doesn't seem to be any tangible benefit to doing this in 1.2 and it can actually cause problems with some LMSes
		 * (e.g. setting it to 'logout' apparently causes Plateau to log the user completely out of the LMS!)
		 * It needs to be on for SCORM 2004 though, otherwise the LMS might not restore the suspend_data
		 */
		this.scorm.handleExitMode = this.isSCORM2004();
	};

	ScormWrapper.prototype.initialize = function() {
		this.lmsConnected = this.scorm.init();

		if (this.lmsConnected) {
			this.startTime = new Date();
			
			this.initTimedCommit();
		}
		else {
			this.handleError("Course could not connect to the LMS");
		}
		
		return this.lmsConnected;
	};

	/**
	* allows you to check if this is the user's first ever 'session' of a SCO, even after the lesson_status has been set to 'incomplete'
	*/
	ScormWrapper.prototype.isFirstSession = function() {
		return (this.getValue(this.isSCORM2004() ? "cmi.entry" :"cmi.core.entry") === "ab-initio");
	};

	ScormWrapper.prototype.setIncomplete = function() {
		this.setValue(this.isSCORM2004() ? "cmi.completion_status" : "cmi.core.lesson_status", "incomplete");

		if(this.commitOnStatusChange) this.commit();
	};

	ScormWrapper.prototype.setCompleted = function() {
		this.setValue(this.isSCORM2004() ? "cmi.completion_status" : "cmi.core.lesson_status", "completed");
		
		if(this.commitOnStatusChange) this.commit();
	};

	ScormWrapper.prototype.setPassed = function() {
		if (this.isSCORM2004()) {
			this.setValue("cmi.completion_status", "completed");
			this.setValue("cmi.success_status", "passed");
		}
		else {
			this.setValue("cmi.core.lesson_status", "passed");
		}

		if(this.commitOnStatusChange) this.commit();
	};

	ScormWrapper.prototype.setFailed = function() {
		if (this.isSCORM2004()) {
			this.setValue("cmi.success_status", "failed");
			
			if(this.setCompletedWhenFailed)
				this.setValue("cmi.completion_status", "completed");
		}
		else {
			this.setValue("cmi.core.lesson_status", "failed");
		}

			if(this.commitOnStatusChange) this.commit();
	};

	ScormWrapper.prototype.getStatus = function() {
		var status = this.getValue(this.isSCORM2004() ? "cmi.completion_status" : "cmi.core.lesson_status");

		switch(status.toLowerCase()) {// workaround for some LMSes (e.g. Arena) not adhering to the all-lowercase rule
			case "passed":
			case "completed":
			case "incomplete":
			case "failed":
			case "browsed":
			case "not attempted":
			case "not_attempted":// mentioned in SCORM 2004 docs but not sure it ever gets used
			case "unknown": //the SCORM 2004 version of not attempted
				return status;
			break;
			default:
				this.handleError("ScormWrapper::getStatus: invalid lesson status '" + status + "' received from LMS");
				return null;
		}
	};

	ScormWrapper.prototype.setStatus = function(status) {
		switch (status.toLowerCase()){
        case "incomplete":
          this.setIncomplete();
          break;
        case "completed":
          this.setCompleted();
          break;
        case "passed":
          this.setPassed();
          break;
        case "failed":
          this.setFailed();
          break;
        default:
          this.handleError("ScormWrapper::setStatus: the status '" + status + "' is not supported.");
          break;
      }
	}

	ScormWrapper.prototype.getScore = function() {
		return this.getValue(this.isSCORM2004() ? "cmi.score.raw" : "cmi.core.score.raw");
	};

	ScormWrapper.prototype.setScore = function(_score, _minScore, _maxScore) {
		if (this.isSCORM2004()) {
			this.setValue("cmi.score.raw", _score) && this.setValue("cmi.score.min", _minScore) && this.setValue("cmi.score.max", _maxScore) && this.setValue("cmi.score.scaled", _score / 100);
		}
		else {
			this.setValue("cmi.core.score.raw", _score);

			if(this.isSupported("cmi.core.score.min")) this.setValue("cmi.core.score.min", _minScore);

			if(this.isSupported("cmi.core.score.max")) this.setValue("cmi.core.score.max", _maxScore);
		}
	};

	ScormWrapper.prototype.getLessonLocation = function() {
		return this.getValue(this.isSCORM2004() ? "cmi.location" : "cmi.core.lesson_location");
	};

	ScormWrapper.prototype.setLessonLocation = function(_location) {
		this.setValue(this.isSCORM2004() ? "cmi.location" : "cmi.core.lesson_location", _location);
	};

	ScormWrapper.prototype.getSuspendData = function() {
		return this.getValue("cmi.suspend_data");
	};

	ScormWrapper.prototype.setSuspendData = function(_data) {
		this.setValue("cmi.suspend_data", _data);
	};

	ScormWrapper.prototype.getStudentName = function() {
		return this.getValue(this.isSCORM2004() ? "cmi.learner_name" : "cmi.core.student_name");
	};

	ScormWrapper.prototype.getStudentId = function(){
		return this.getValue(this.isSCORM2004() ? "cmi.learner_id":"cmi.core.student_id");
	};

	ScormWrapper.prototype.commit = function() {
		this.logger.debug("ScormWrapper::commit");
		
		if (this.lmsConnected) {
			if (this.commitRetryPending) {
				this.logger.debug("ScormWrapper::commit: skipping this commit call as one is already pending.");
			}
			else {
				if (this.scorm.save()) {
					this.commitRetries = 0;
					this.lastCommitSuccessTime = new Date();
				}
				else {
					if (this.commitRetries < this.maxCommitRetries && !this.finishCalled) {
						this.commitRetries++;
						this.initRetryCommit();
					}
					else {
						var _errorCode = this.scorm.debug.getCode();

						var _errorMsg = "Course could not commit data to the LMS";
						_errorMsg += "\nError " + _errorCode + ": " + this.scorm.debug.getInfo(_errorCode);
						_errorMsg += "\nLMS Error Info: " + this.scorm.debug.getDiagnosticInfo(_errorCode);

						this.handleError(_errorMsg);
					}
				}
			}
		}
		else {
			this.handleError("Course is not connected to the LMS");
		}
	};

	ScormWrapper.prototype.finish = function() {
		this.logger.debug("ScormWrapper::finish");
		
		if (this.lmsConnected && !this.finishCalled) {
			this.finishCalled = true;
			
			if(this.timedCommitIntervalID != null) {
				window.clearInterval(this.timedCommitIntervalID);
			}
			
			if(this.commitRetryPending) {
				window.clearTimeout(this.retryCommitTimeoutID);
				this.commitRetryPending = false;
			}
			
			if (this.logOutputWin && !this.logOutputWin.closed) {
				this.logOutputWin.close();
			}
			
			this.endTime = new Date();
			
			if (this.isSCORM2004()) {
				this.scorm.set("cmi.session_time", this.convertToSCORM2004Time(this.endTime.getTime() - this.startTime.getTime()));
			}
			else {
				this.scorm.set("cmi.core.session_time", this.convertToSCORM12Time(this.endTime.getTime() - this.startTime.getTime()));
				this.scorm.set("cmi.core.exit", "");
			}
			
			// api no longer available from this point
			this.lmsConnected = false;
			
			if (!this.scorm.quit()) {
				this.handleError("Course could not finish");
			}
		}
		else {
			this.handleError("Course is not connected to the LMS");
		}
	};

	ScormWrapper.prototype.recordInteraction = function(id, response, correct, latency, type) {
		if(this.isSupported("cmi.interactions._count")) {
			switch(type) {
				case "choice":
					this.recordInteractionMultipleChoice.apply(this, arguments);
					break;

				case "matching":
					this.recordInteractionMatching.apply(this, arguments);
					break;

				case "numeric":
					this.isSCORM2004() ? this.recordInteractionScorm2004.apply(this, arguments) : this.recordInteractionScorm12.apply(this, arguments);
					break;

				case "fill-in":
					this.recordInteractionFillIn.apply(this, arguments);
					break;

				default:
					console.error("ScormWrapper.recordInteraction: unknown interaction type of '" + type + "' encountered...");
			}
		}
		else {
			this.logger.info("ScormWrapper::recordInteraction: cmi.interactions are not supported by this LMS...");
		}
	};

	/****************************** private methods ******************************/
	ScormWrapper.prototype.getValue = function(_property) {
		this.logger.debug("ScormWrapper::getValue: _property=" + _property);

		if(this.finishCalled) {
			this.logger.debug("ScormWrapper::getValue: ignoring request as 'finish' has been called");
			return;
		}
		
		if (this.lmsConnected) {
			var _value = this.scorm.get(_property);
			var _errorCode = this.scorm.debug.getCode();
			var _errorMsg = "";
			
			if (_errorCode !== 0) {
				if (_errorCode === 403) {
					this.logger.warn("ScormWrapper::getValue: data model element not initialized");
				}
				else {
					_errorMsg += "Course could not get " + _property;
					_errorMsg += "\nError Info: " + this.scorm.debug.getInfo(_errorCode);
					_errorMsg += "\nLMS Error Info: " + this.scorm.debug.getDiagnosticInfo(_errorCode);
					
					this.handleError(_errorMsg);
				}
			}
			this.logger.debug("ScormWrapper::getValue: returning " + _value);
			return _value + "";
		}
		else {
			this.handleError("Course is not connected to the LMS");
		}
	};

	ScormWrapper.prototype.setValue = function(_property, _value) {
		this.logger.debug("ScormWrapper::setValue: _property=" + _property + " _value=" + _value);

		if(this.finishCalled) {
			this.logger.debug("ScormWrapper::setValue: ignoring request as 'finish' has been called");
			return;
		}
		
		if (this.lmsConnected) {
			var _success = this.scorm.set(_property, _value);
			var _errorCode = this.scorm.debug.getCode();
			var _errorMsg = "";
			
			if (!_success) {
			/*
			* Some LMSes have an annoying tendency to return false from a set call even when it actually worked fine.
			* So, we should throw an error _only_ if there was a valid error code...
			*/
				if(_errorCode !== 0) {
					_errorMsg += "Course could not set " + _property + " to " + _value;
					_errorMsg += "\nError Info: " + this.scorm.debug.getInfo(_errorCode);
					_errorMsg += "\nLMS Error Info: " + this.scorm.debug.getDiagnosticInfo(_errorCode);
					
					this.handleError(_errorMsg);
				}
				else {
					this.logger.warn("ScormWrapper::setValue: LMS reported that the 'set' call failed but then said there was no error!");
				}
			}
			
			return _success;
		}
		else {
			this.handleError("Course is not connected to the LMS");
		}
	};

	/**
	* used for checking any data field that is not 'LMS Mandatory' to see whether the LMS we're running on supports it or not.
	* Note that the way this check is being performed means it wouldn't work for any element that is
	* 'write only', but so far we've not had a requirement to check for any optional elements that are.
	*/
	ScormWrapper.prototype.isSupported = function(_property) {
		this.logger.debug("ScormWrapper::isSupported: _property=" + _property);

		if(this.finishCalled) {
			this.logger.debug("ScormWrapper::isSupported: ignoring request as 'finish' has been called");
			return;
		}
		
		if (this.lmsConnected) {
			var _value = this.scorm.get(_property);
			var _errorCode = this.scorm.debug.getCode();
			
			return (_errorCode === 401 ? false : true);
		}
		else {
			this.handleError("Course is not connected to the LMS");
			return false;
		}
	};

	ScormWrapper.prototype.initTimedCommit = function() {
		this.logger.debug("ScormWrapper::initTimedCommit");
		
		if(this.timedCommitFrequency > 0) {
			var delay = this.timedCommitFrequency * (60 * 1000);
			this.timedCommitIntervalID = window.setInterval(_.bind(this.commit, this), delay);
		}
	};

	ScormWrapper.prototype.initRetryCommit = function() {
		this.logger.debug("ScormWrapper::initRetryCommit " + this.commitRetries + " out of " + this.maxCommitRetries);
		
		this.commitRetryPending = true;// stop anything else from calling commit until this is done
		
		this.retryCommitTimeoutID = window.setTimeout(_.bind(this.doRetryCommit, this), this.commitRetryDelay);
	};

	ScormWrapper.prototype.doRetryCommit = function() {
		this.logger.debug("ScormWrapper::doRetryCommit");

		this.commitRetryPending = false;

		this.commit();
	};

	ScormWrapper.prototype.handleError = function(_msg) {
		this.logger.error(_msg);
		
		if (!this.suppressErrors && (!this.logOutputWin || this.logOutputWin.closed) && confirm("An error has occured:\n\n" + _msg + "\n\nPress 'OK' to view debug information to send to technical support."))
			this.showDebugWindow();
	};


	ScormWrapper.prototype.getInteractionCount = function(){

		var count = this.getValue("cmi.interactions._count");

		return count === "" ? 0 : count;
	};
	
	ScormWrapper.prototype.recordInteractionScorm12 = function(id, response, correct, latency, type) {
		
		id = this.trim(id);

		var cmiPrefix = "cmi.interactions." + this.getInteractionCount();
		
		this.setValue(cmiPrefix + ".id", id);
		this.setValue(cmiPrefix + ".type", type);
		this.setValue(cmiPrefix + ".student_response", response);
		this.setValue(cmiPrefix + ".result", correct ? "correct" : "wrong");
		if (!_.isEmpty(latency)) this.setValue(cmiPrefix + ".latency", this.convertToSCORM12Time(latency));
		this.setValue(cmiPrefix + ".time", this.getCMITime());
	};


	ScormWrapper.prototype.recordInteractionScorm2004 = function(id, response, correct, latency, type) {

		id = this.trim(id);

		var cmiPrefix = "cmi.interactions." + this.getInteractionCount();
		
		this.setValue(cmiPrefix + ".id", id);
		this.setValue(cmiPrefix + ".type", type);
		this.setValue(cmiPrefix + ".learner_response", response);
		this.setValue(cmiPrefix + ".result", correct ? "correct" : "incorrect");
		if (!_.isEmpty(latency)) this.setValue(cmiPrefix + ".latency", this.convertToSCORM2004Time(latency));
		this.setValue(cmiPrefix + ".timestamp", this.getISO8601Timestamp());
	};


	ScormWrapper.prototype.recordInteractionMultipleChoice = function(id, response, correct, latency, type) {
		
		if(this.isSCORM2004()) {
			response = response.replace(/,|#/g, "[,]");
		} else {
			response = response.replace(/#/g, ",");
		}
		
		var scormRecordInteraction = this.isSCORM2004() ? this.recordInteractionScorm2004 : this.recordInteractionScorm12;

		scormRecordInteraction.call(this, id, response, correct, latency, type);
	};

	
	ScormWrapper.prototype.recordInteractionMatching = function(id, response, correct, latency, type) {

		response = response.replace(/#/g, ",");

		if(this.isSCORM2004()) {
			response = response.replace(/,/g, "[,]");
			response = response.replace(/\./g, "[.]");
		}
		
		var scormRecordInteraction = this.isSCORM2004() ? this.recordInteractionScorm2004 : this.recordInteractionScorm12;

		scormRecordInteraction.call(this, id, response, correct, latency, type);
	};


	ScormWrapper.prototype.recordInteractionFillIn = function(id, response, correct, latency, type) {
		
		var maxLength = this.isSCORM2004() ? 250 : 255;

		if(response.length > maxLength) {
			response = response.substr(0,maxLength);

			this.logger.warn("ScormWrapper::recordInteractionFillIn: response data for " + id + " is longer than the maximum allowed length of " + maxLength + " characters; data will be truncated to avoid an error.");
		}

		var scormRecordInteraction = this.isSCORM2004() ? this.recordInteractionScorm2004 : this.recordInteractionScorm12;

		scormRecordInteraction.call(this, id, response, correct, latency, type);
	};

	ScormWrapper.prototype.showDebugWindow = function() {
		
		if (this.logOutputWin && !this.logOutputWin.closed) {
			this.logOutputWin.close();
		}
		
		this.logOutputWin = window.open("log_output.html", "Log", "width=600,height=300,status=no,scrollbars=yes,resize=yes,menubar=yes,toolbar=yes,location=yes,top=0,left=0");
		
		if (this.logOutputWin)
			this.logOutputWin.focus();
		
		return;
	};

	ScormWrapper.prototype.convertToSCORM12Time = function(msConvert) {
		
		var msPerSec = 1000;
		var msPerMin = msPerSec * 60;
		var msPerHour = msPerMin * 60;

		var ms = msConvert % msPerSec;
		msConvert = msConvert - ms;

		var secs = msConvert % msPerMin;
		msConvert = msConvert - secs;
		secs = secs / msPerSec;

		var mins = msConvert % msPerHour;
		msConvert = msConvert - mins;
		mins = mins / msPerMin;

		var hrs = msConvert / msPerHour;

		if(hrs > 9999) {
			return "9999:99:99.99";
		}
		else {
			var str = [this.padWithZeroes(hrs,4), this.padWithZeroes(mins, 2), this.padWithZeroes(secs, 2)].join(":");
			return (str + '.' + Math.floor(ms/10));
		}
	};

	/**
	* Converts milliseconds into the SCORM 2004 data type 'timeinterval (second, 10,2)'
	* this will output something like 'PT2H5M10S' a value which indicates a period of time of 2 hours, 5 minutes & 10 seconds
	*/
	ScormWrapper.prototype.convertToSCORM2004Time = function(msConvert) {

		var timeinterval = "";
		var csConvert = Math.floor(msConvert / 10)

		var csPerSec = 100;
		var csPerMin = csPerSec * 60;
		var csPerHour = csPerMin * 60;
		var csPerDay = csPerHour * 24;

		var days = Math.floor(csConvert/ csPerDay);
		csConvert -= days * csPerDay
		days = days ? days+"D": "";

		var hours = Math.floor(csConvert/ csPerHour);
		csConvert -= hours * csPerHour
		hours = hours ? hours+"H": "";

		var mins = Math.floor(csConvert/ csPerMin);
		csConvert -= mins * csPerMin
		mins = mins ? mins+"M": "";

		var secs = Math.floor(csConvert/ csPerSec);
		csConvert -= secs * csPerSec
		secs = secs ? secs: "";

		var cs = csConvert;
		cs = cs ? "."+cs+"S": "";

		var hms = [hours,mins,secs,cs].join("");

		hms = hms.length ? "T" + hms: hms;

		timeinterval = days + hms;
		timeinterval = timeinterval.length ? timeinterval : "0S";

		return "P" + timeinterval;
	};

	ScormWrapper.prototype.getCMITime = function() {
		
		var date = new Date();

		var hours = this.padWithZeroes(date.getHours(),2);
		var min = this.padWithZeroes(date.getMinutes(),2);
		var sec = this.padWithZeroes(date.getSeconds(),2);

		return [hours, min, sec].join(":");
	};

	ScormWrapper.prototype.getISO8601Timestamp = function() {
	
		var date = new Date();
		
		var ymd = [
			date.getFullYear(),
			this.padWithZeroes(date.getMonth()+1,2),
			this.padWithZeroes(date.getDate(),2)
		].join("-");

		var hms = [
			this.padWithZeroes(date.getHours(),2),
			this.padWithZeroes(date.getMinutes(),2),
			this.padWithZeroes(date.getSeconds(),2)
		].join(":");


		return ymd+"T"+hms;
	};

	ScormWrapper.prototype.padWithZeroes = function(numToPad, padBy) {

		var len = padBy;

		while(--len){ numToPad = "0" + numToPad }

		return numToPad.slice(-padBy);
	};

	ScormWrapper.prototype.trim = function(str) {
		return str.replace(/^\s*|\s*$/g, "");
	};

	ScormWrapper.prototype.isSCORM2004 = function() {
		return this.scorm.version === "2004";
	};

	return ScormWrapper;
});

Logger = function() {
	this.logArr = new Array();
	this.registeredViews = new Array();
};

// static
Logger.instance = null;
Logger.LOG_TYPE_INFO = 0;
Logger.LOG_TYPE_WARN = 1;
Logger.LOG_TYPE_ERROR = 2;
Logger.LOG_TYPE_DEBUG = 3;

Logger.getInstance = function() {
	if (Logger.instance == null)
		Logger.instance = new Logger();
	return Logger.instance;
};

Logger.prototype.getEntries = function() {
	return this.logArr;
};

Logger.prototype.getLastEntry = function() {
	return this.logArr[this.logArr.length - 1];
};

Logger.prototype.info = function(str) {
	this.logArr[this.logArr.length] = {str:str, type:Logger.LOG_TYPE_INFO};
	this.updateViews();
};

Logger.prototype.warn = function(str) {
	this.logArr[this.logArr.length] = {str:str, type:Logger.LOG_TYPE_WARN};
	this.updateViews();
};

Logger.prototype.error = function(str) {
	this.logArr[this.logArr.length] = {str:str, type:Logger.LOG_TYPE_ERROR};
	this.updateViews();
};

Logger.prototype.debug = function(str) {
	this.logArr[this.logArr.length] = {str:str, type:Logger.LOG_TYPE_DEBUG};
	this.updateViews();
};

//register a view
Logger.prototype.registerView = function(_view) {
	this.registeredViews[this.registeredViews.length] = _view;
};

//unregister a view
Logger.prototype.unregisterView = function(_view) {
	for (var i = 0; i < this.registeredViews.length; i++)
		if (this.registeredViews[i] == _view) {
			this.registeredViews.splice(i, 1);
			i--;
		}
};

// update all views
Logger.prototype.updateViews = function() {
	for (var i = 0; i < this.registeredViews.length; i++) {
		if (this.registeredViews[i])
			this.registeredViews[i].update(this);
	}
};
define("extensions/adapt-contrib-spoor/js/scorm/logger", function(){});

define('extensions/adapt-contrib-spoor/js/scorm',[
	'./scorm/API',
 	'./scorm/wrapper',
	'./scorm/logger',
], function(API, wrapper, logger) {

	//Load and prepare SCORM API

	return wrapper.getInstance();

});
define('extensions/adapt-contrib-spoor/js/serializers/default',[
    'coreJS/adapt'
], function (Adapt) {

    //Captures the completion status of the blocks
    //Returns and parses a '1010101' style string

    var serializer = {
        serialize: function () {
            return this.serializeSaveState('_isComplete');
        },

        serializeSaveState: function(attribute) {
            if (Adapt.course.get('_latestTrackingId') === undefined) {
                var message = "This course is missing a latestTrackingID.\n\nPlease run the grunt process prior to deploying this module on LMS.\n\nScorm tracking will not work correctly until this is done.";
                console.error(message);
            }

            var excludeAssessments = Adapt.config.get('_spoor') && Adapt.config.get('_spoor')._tracking && Adapt.config.get('_spoor')._tracking._excludeAssessments;

            // create the array to be serialised, pre-populated with dashes that represent unused tracking ids - because we'll never re-use a tracking id in the same course
            var data = [];
            var length = Adapt.course.get('_latestTrackingId') + 1;
            for (var i = 0; i < length; i++) {
                data[i] = "-";
            }

            // now go through all the blocks, replacing the appropriate dashes with 0 (incomplete) or 1 (completed) for each of the blocks
            _.each(Adapt.blocks.models, function(model, index) {
                var _trackingId = model.get('_trackingId'),
                    isPartOfAssessment = model.getParent().get('_assessment'),
                    state = model.get(attribute) ? 1: 0;

                if(excludeAssessments && isPartOfAssessment) {
                    state = 0;
                }

                if (_trackingId === undefined) {
                    var message = "Block '" + model.get('_id') + "' doesn't have a tracking ID assigned.\n\nPlease run the grunt process prior to deploying this module on LMS.\n\nScorm tracking will not work correctly until this is done.";
                    console.error(message);
                } else {
                    data[_trackingId] = state;
                }
            }, this);

            return data.join("");
        },

        deserialize: function (completion) {

            _.each(this.deserializeSaveState(completion), function(state, blockTrackingId) {
                if (state === 1) {
                    this.markBlockAsComplete(Adapt.blocks.findWhere({_trackingId: blockTrackingId}));
                }
            }, this);

        },    

        deserializeSaveState: function (string) {
            var completionArray = string.split("");

            for (var i = 0; i < completionArray.length; i++) {
                if (completionArray[i] === "-") {
                    completionArray[i] = -1;
                } else {
                    completionArray[i] = parseInt(completionArray[i], 10);
                }
            }

            return completionArray;
        },

        markBlockAsComplete: function(block) {
            if (!block || block.get('_isComplete')) {
                return;
            }
        
            block.getChildren().each(function(child) {
                child.set('_isComplete', true);
            }, this);
        }

    };

    return serializer;
});
//https://raw.githubusercontent.com/oliverfoster/SCORMSuspendDataSerializer 2015-06-27
(function(_) {

	function toPrecision(number, precision) {
		if (precision === undefined) precision = 2
		var multiplier = 1 * Math.pow(10, precision);
		return Math.round(number * multiplier) / multiplier;
	}

	function BinaryToNumber(bin, length) {
		return parseInt(bin.substr(0, length), 2);
	}

	function NumberToBinary(number, length) {
		return Padding.fillLeft( number.toString(2), length );
	}

	var Padding = {
		addLeft: function PaddingAddLeft(str, x , char) {
			char = char || "0";
			return (new Array( x + 1)).join(char) + str;
		},
		addRight: function PaddingAddRight(str, x, char) {
			char = char || "0";
			return  str + (new Array( x + 1)).join(char);
		},
		fillLeft: function PaddingFillLeft(str, x, char) {
			if (str.length < x) {
	        	var paddingLength = x - str.length;
	        	return Padding.addLeft(str, paddingLength, char)
	        }
	        return str;
		},
		fillRight: function PaddingFillLeft(str, x, char) {
			if (str.length < x) {
	        	var paddingLength = x - str.length;
	        	return Padding.addRight(str, paddingLength, char)
	        }
	        return str;
		},
		fillBlockLeft: function PaddingFillBlockRight(str, x, char) {
			if (str.length % x) {
	        	var paddingLength = x - (str.length % x);
	        	return Padding.addLeft(str, paddingLength, char)
	        }
	        return str;
		},
		fillBlockRight: function PaddingFillBlockRight(str, x, char) {
			if (str.length % x) {
	        	var paddingLength = x - (str.length % x);
	        	return Padding.addRight(str, paddingLength, char)
	        }
	        return str;
		}
	};

	function Base64() {
		switch (arguments.length) {
		case 1:
			var firstArgumentType = typeof arguments[0];
			switch (firstArgumentType) {
			case "number":
				return Base64._indexes[arguments[0]];
			case "string":
				return Base64._chars[arguments[0]];
			default:
				throw "Invalid arguments type";
			}
		case 2:
			var char = arguments[0];
			var index = arguments[1];
			Base64._chars[char] = index;
			Base64._indexes[index] = char;
			return;
		default:
			throw "Invalid number of arguments";
		}
	}
	Base64._chars = {};
	Base64._indexes = {};
	(function() {
		var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
		for (var i = 0, l = alphabet.length; i<l; i++) {
			Base64(alphabet[i], i);
		}
	})();


	function DataType() {
		switch (arguments.length) {
		case 1:
			switch (typeof  arguments[0]) {
			case "object":
				var item = arguments[0]
				if (DataType._types[item.type] === undefined) DataType._types[item.type] = [];
				DataType._types[item.type].push(item);
				item.index = DataType._indexes.length
				DataType._indexes.push(item);
				DataType[item.name] = item;
				return;
			case "string":
				return DataType.getName(arguments[0]);
			case "number":
				return DataType.getIndex(arguments[0]);
			default:
				throw "Argument type not allowed";
			}
		default:
			throw "Too many arguments";
		}
		
	}
	DataType.VARIABLELENGTHDESCRIPTORSIZE = 8;
	DataType._types = {};
	DataType._indexes = [];
	DataType.getName = function DataTypeGetName(name) {
		if (DataType[name])
			return DataType[name];
		throw "Type name not found '"+name+"'";
	};
	DataType.getIndex = function DataTypeGetIndex(index) {
		if (DataType._indexes[index])
			return DataType._indexes[index];
		throw "Type index not found '"+index+"'";
	};
	DataType.getTypes = function DataTypeGetTypes(type) {
		if (DataType._types[type])
			return DataType._types[type];
		throw "Type not found '"+type+"'";
	};
	DataType.checkBounds = function DataTypeCheckBounds(name, number) {
		var typeDef = DataType(name);
		if (number > typeDef.max) throw name + " value is larger than "+typeDef.max;
		if (number < typeDef.min) throw name + " value is smaller than "+typeDef.min;
	};
	DataType.getNumberType = function DataTypeGetNumberType(number) {
		var isDecimal = (number - Math.floor(number)) !== 0;
		var numberDataTypes = DataType.getTypes("number");
		for (var t = 0, type; type = numberDataTypes[t++];) {
			if (number <= type.max && number >= type.min && (!isDecimal || isDecimal == type.decimal) ) {
				return type;
			}
		}
	};
	DataType.getVariableType = function DataTypeGetVariableType(variable) {
		var variableNativeType = variable instanceof Array ? "array" : typeof variable;
		var variableDataType;

		switch(variableNativeType) {
		case "number":
			variableDataType = DataType.getNumberType(variable);
			break;
		case "string":
			variableDataType = DataType.getName("string");
			break;
		default: 
			var supportedItemDataTypes = DataType.getTypes(variableNativeType);
			switch (supportedItemDataTypes.length) {
			case 1:
				variableDataType = supportedItemDataTypes[0];
				break;
			default:
				throw "Type not found '"+variableNativeType+"'";
			}
		}
	
		if (!variableDataType) throw "Cannot assess type '"+variableNativeType+"'";

		return variableDataType;
	};
	DataType.getArrayType = function getArrayType(arr) {
		var foundItemTypes = [];

		for (var i = 0, l = arr.length; i < l; i++) {
			var item = arr[i];
			var itemDataType = DataType.getVariableType(item);

			if (_.findWhere(foundItemTypes, { name: itemDataType.name })) continue;
	
			foundItemTypes.push(itemDataType);
		}

		switch (foundItemTypes.length) {
		case 0:
			throw "Cannot determine array data types";
		case 1:
			//single value type
		 	return foundItemTypes[0];
		default: 
			//many value types
			var nativeTypeNames = _.pluck(foundItemTypes, 'type');
			var uniqueNativeTypeNames = _.uniq(nativeTypeNames);
			var hasManyNativeTypes = (uniqueNativeTypeNames.length > 1);

			if (hasManyNativeTypes) return DataType("variable"); //multiple types in array

			//single native type in array, multiple datatype lengths
			switch (uniqueNativeTypeNames[0]) {
			case "number":
				var foundDecimal = _.findWhere(foundItemTypes, { decimal: true});
				if (foundDecimal) return foundDecimal;
				return _.max(foundItemTypes, function(type) {
					return type.max;
				});
			}

			throw "Unsupported data types";
		}
		
	};
	(function() {
		var types = [
			{
				"size": "fixed",
				"length": 1,
				"name": "boolean",
				"type": "boolean"
			},
			{
				"max": 15,
				"min": 0,
				"decimal": false,
				"size": "fixed",
				"length": 4,
				"name": "half",
				"type": "number"
			},
			{
				"max": 255,
				"min": 0,
				"decimal": false,
				"size": "fixed",
				"length": 8,
				"name": "byte",
				"type": "number"
			},
			{
				"max": 65535,
				"min": 0,
				"decimal": false,
				"size": "fixed",
				"length": 16,
				"name": "short",
				"type": "number"
			},
			{
				"max": 4294967295,
				"min": 0,
				"decimal": false,
				"size": "fixed",
				"length": 32,
				"name": "long",
				"type": "number"
			},
			{
				"max": 4294967295,
				"min": -4294967295,
				"decimal": true,
				"precision": 2,
				"size": "variable",
				"name": "double",
				"type": "number"
			},
			{
				"name": "base16",
				"size": "variable",
				"type": "string"
			},
			{
				"name": "base64",
				"size": "variable",
				"type": "string"
			},
			{
				"name": "array",
				"size": "variable",
				"type": "array"
			},
			{
				"name": "variable",
				"size": "variable",
				"type": "variable"
			},
			{
				"name": "string",
				"size": "variable",
				"type": "string"
			}
		];
		for (var i = 0, type; type = types[i++];) {
			DataType(type);
		}
	})();

	

	function Converter(fromType, toType) {
		fromType = Converter.translateTypeAlias(fromType);
		toType = Converter.translateTypeAlias(toType);

		var args = [].slice.call(arguments, 2);

		if (fromType != "binary" && toType != "binary") {
			if (!Converter._converters[fromType]) throw "Type not found '" + fromType + "'";
			if (!Converter._converters[fromType]['binary']) throw "Type not found 'binary'";
			
			var bin = Converter._converters[fromType]['binary'].call(this, args[0], Converter.WRAPOUTPUT);

			if (!Converter._converters['binary'][toType]) throw "Type not found '"+toType+"'";

			return Converter._converters['binary'][toType].call(this, bin, Converter.WRAPOUTPUT);
		}

		if (!Converter._converters[fromType]) throw "Type not found '" + fromType + "'";
		if (!Converter._converters[fromType][toType]) throw "Type not found '" + toType + "'";

		return Converter._converters[fromType][toType].call(this, args[0], Converter.WRAPOUTPUT);
	}
	Converter.WRAPOUTPUT = false;
	Converter.translateTypeAlias = function ConverterTranslateTypeAlias(type) {
		type = type.toLowerCase();
		for (var Type in Converter._typeAliases) {
			if (Type == type || (" "+Converter._typeAliases[Type].join(" ")+" ").indexOf(" "+type+" ") >= 0 ) return Type;
		}
		throw "Type not found '" + type + "'";
	};
	Converter._typeAliases = {
		"base64": [ "b64" ],
		"base16" : [ "hex", "b16" ],
		"double": [ "dbl", "decimal", "d" ],
		"long": [ "lng", "l" ],
		"short": [ "s" ],
		"byte" : [ "b" ],
		"half": [ "h" ],
		"number": [ "num", "n" ],
		"binary": [ "bin" ],
		"boolean": [ "bool" ],
		"array": [ "arr" ]
	};
	Converter._variableWrapLength = function ConverterVariableWrapLength(bin) {
		var variableLength = bin.length;
		var binLength = NumberToBinary(variableLength, DataType.VARIABLELENGTHDESCRIPTORSIZE)

		return binLength + bin;
	};
	Converter._variableLength = function ConverterVariableLength(bin) {
		var VLDS =  DataType.VARIABLELENGTHDESCRIPTORSIZE;
		var variableLength = BinaryToNumber(bin, VLDS );
		return variableLength;
	};
	Converter._variableUnwrapLength = function ConverterVariableUnwrapLength(bin) {
		var VLDS =  DataType.VARIABLELENGTHDESCRIPTORSIZE;
		var variableLength = BinaryToNumber(bin, VLDS );

		return bin.substr( VLDS, variableLength);
	};
	Converter._converters = {
		"base64": {
			"binary": function ConverterBase64ToBinary(base64) { //TODO PADDING... ?
				var firstByte = Base64(base64.substr(0,1));
				var binFirstByte = NumberToBinary(firstByte, 6);
				var paddingLength = BinaryToNumber(binFirstByte, 6);

			    var bin = "";
			    for (var i = 0, ch; ch = base64[i++];) {
			        var block = Base64(ch).toString(2);
			        block = Padding.fillLeft(block, 6);
			        bin += block;
			    }
			    bin =  bin.substr(6+paddingLength);
			    return bin;
			}
		},
		"base16": {
			"binary": function ConverterBase16ToBinary(hex) {
				var firstByte = Base64(base64.substr(0,1));
				var binFirstByte = NumberToBinary(firstByte, 4);
				var paddingLength = BinaryToNumber(binFirstByte, 4);

			    var bin = "";
			    for (var i = 0, ch; ch = hex[i++];) {
			        var block = parseInt(ch, 16).toString(2);
			        block = Padding.fillLeft(block, 4);
			        bin += block;
			    }

			     bin =  bin.substr(6+paddingLength);
			    return bin;
			}
		},
		"double": {
			"binary": function ConverterDoubleToBinary(dbl, wrap) {
				var typeDef = DataType("double");
				DataType.checkBounds("double", dbl);

				dbl = toPrecision(dbl, typeDef.precision);

				var dblStr = dbl.toString(10);

				var isMinus = dbl < 0;
			
				var baseStr, exponentStr, highStr, lowStr, decimalPosition, hasDecimal;

				
				var exponentPos = dblStr.indexOf("e");
				if (exponentPos > -1) {
					//exponential float representation "nE-x"
					baseStr = dblStr.substr(0, exponentPos);
					exponentStr = Math.abs(dblStr.substr(exponentPos+1));

					if (isMinus) baseStr = baseStr.substr(1);

					decimalPosition = baseStr.indexOf(".");
					hasDecimal = (decimalPosition > -1);

					if (hasDecimal) {
						highStr = baseStr.substr(0, decimalPosition);
						lowStr = baseStr.substr(decimalPosition+1);

						exponentStr = (Math.abs(exponentStr) + lowStr.length);

						baseStr = highStr + lowStr;
					}

				} else {
					//normal long float representation "0.00000000"
					baseStr = dblStr;
					exponentStr = "0";

					if (isMinus) dblStr = dblStr.substr(1);

					decimalPosition = dblStr.indexOf(".");
					hasDecimal = (decimalPosition > -1);
					if (hasDecimal) {
						highStr = dblStr.substr(0, decimalPosition);
						lowStr = dblStr.substr(decimalPosition+1);

						exponentStr = (lowStr.length);
						if (highStr == "0") {
							baseStr = parseInt(lowStr, 10).toString(10);
						} else {
							baseStr = highStr + lowStr;
						}
					} else {
						baseStr = dblStr;
					}

				}

				var bin = [];

				var binLong = Padding.fillBlockLeft (parseInt(baseStr, 10).toString(2), 4);
				var binMinus = isMinus ? "1" : "0";
				var binExponent = Padding.fillLeft( parseInt(exponentStr, 10).toString(2), 7);
				
				bin.push( binMinus );
				bin.push( binExponent );
				bin.push( binLong );

				if (wrap === false) {
					return bin.join("");
				} else {
					return Converter._variableWrapLength(bin.join(""));
				}
			}
		},
		"long": {
			"binary": function ConverterLongToBinary(value) {
				var typeDef = DataType("long");
				DataType.checkBounds("long", value);
				value = toPrecision(value, 0);
				return Padding.fillLeft(value.toString(2), typeDef.length);
			}
		},
		"short": {
			"binary": function ConverterShortToBinary(value) {
				var typeDef = DataType("short");
				DataType.checkBounds("short", value);
				value = toPrecision(value, 0);
				return Padding.fillLeft(value.toString(2), typeDef.length);
			}
		},
		"byte": {
			"binary": function ConverterByteToBinary(value) {
				var typeDef = DataType("byte");
				DataType.checkBounds("byte", value);
				value = toPrecision(value, 0);
				return Padding.fillLeft(value.toString(2), typeDef.length);
			}
		},
		"half": {
			"binary": function ConverterHalfToBinary(value) {
				var typeDef = DataType("half");
				DataType.checkBounds("half", value);
				value = toPrecision(value, 0);
				return Padding.fillLeft(value.toString(2), typeDef.length);
			}
		},
		"boolean": {
			"binary": function ConverterBooleanToBinary(bool) {
				return bool ? "1" : "0";
			},
		},
		"array": {
			"binary": function ConverterArrayToBinary(arr, wrap) { //TODO PADDING NOT GOOD
				var typeDef = DataType("array");
				var arrayItemType = DataType.getArrayType(arr);
				var isVariableArray = arrayItemType.name == "vairable";

				if (isVariableArray) {
					var bin = half2bin(15);
					//variable array
					return bin;
				} else {
					var binArrayIdentifier = Converter._converters['half']['binary'](arrayItemType.index);

					var binItemsArray = [];
					for (var i = 0, l = arr.length; i < l; i++) {
						var item = arr[i];
						var binItem = Converter._converters[arrayItemType.name]['binary'](item);
						//console.log("binItem", binItem);
						binItemsArray.push( binItem );
					}

					var binItems = binItemsArray.join("");

					var paddingLength = 0;
					if (binItems.length % 4) paddingLength = 4 - (binItems.length % 4);
					var binPaddingLen = NumberToBinary(paddingLength, 2);

					var binPadding = (new Array(paddingLength+1)).join("0");

					var bin = [];
					bin.push(binArrayIdentifier);
					bin.push(binPaddingLen);
					bin.push(binPadding);
					bin.push(binItems);

					var finished = bin.join("");
					//console.log("unwrapped", finished);

					if (wrap === false) return finished;

					var wrapped = Converter._variableWrapLength( finished);
					//console.log("wrapped", wrapped);

					return wrapped;
				}

			}
		},
		"binary": {
			"array": function ConverterBinaryToArray(bin, wrap) { //TODO PADDING NOT GOOD
				var typeDef = DataType("array");

				//console.log("wrapped", bin);
				if (wrap !== false)
					bin = Converter._variableUnwrapLength( bin);
				//console.log("unwrapped", bin);

				var binArrayIdentifier = bin.substr(0, 4);
				var binPaddingLen = bin.substr(4 , 2);

				var arrayIdentifier = Converter._converters['binary'][ 'half' ]( binArrayIdentifier );
				var paddingLength = BinaryToNumber( binPaddingLen, 2 );

				var dataStart = 4 + 2 + paddingLength;
				var dataLength = bin.length - dataStart;

				var binItems = bin.substr(dataStart, dataLength );

				var arrayItemType = DataType(arrayIdentifier);
				var isVariableArray = arrayItemType.name == "variable";

				var rtn = [];
				if (isVariableArray) {

				} else {
					var hasVariableLengthChildren = arrayItemType.size == "variable";
					if (hasVariableLengthChildren) {
						var VLDS = DataType.VARIABLELENGTHDESCRIPTORSIZE;
						while ( binItems != "" ) {
							
							var variableLength = Converter._variableLength( binItems );
							var binItem = binItems.substr(0, VLDS + variableLength);
							binItems = binItems.substr(VLDS+variableLength);
							//console.log("binItem", binItem, BinaryToNumber(binItem, 16));

							rtn.push( Converter._converters['binary'][ arrayItemType.name ]( binItem) );
						}
					} else {
						while ( binItems != "" ) {
							var binItem = binItems.substr(0, arrayItemType.length);
							binItems = binItems.substr(arrayItemType.length);

							rtn.push( Converter._converters['binary'][ arrayItemType.name ](binItem) );
						}
					}

				}


				return rtn;

			},
			"base64": function ConverterBinaryToBase64(bin) { //TODO PADDING NOT GOOD
				var paddingLength = 0;
				if (bin.length % 6) paddingLength = 6 - (bin.length % 6);
				binPaddingLen = NumberToBinary(paddingLength, 6);
				binPadding = Padding.addLeft("", paddingLength);
				bin = binPaddingLen + binPadding + bin;

				var binLength = bin.length;
			    var base64 = "";
			    for (var b = 0; b < 10000; b++) {
			        if (b*6 >= binLength) break;
			     
			        var block = bin.substr(b*6,6);
			        base64 += Base64(parseInt(block, 2));
			    }

			    return base64;
			},
			"base16": function ConverterBinaryToBase16(bin) {
				var paddingLength = 0;
				if (bin.length % 4) paddingLength = 4 - (bin.length % 4);
				binPaddingLen = NumberToBinary(paddingLength, 4);
				binPadding = Padding.addLeft("", paddingLength);
				bin = binPaddingLen + binPadding + bin;

			    var binLength = bin.length;
			    var hex = "";
			    for (var b = 0; b < 10000; b++) {
			        if (b*4 >= binLength) break;
			     
			        var block = bin.substr(b*4,4);
			        hex += parseInt(block, 2).toString(16);
			    }
			    return hex;
			},
			"double": function ConverterBinaryToDouble(bin, wrap) {
				var typeDef = DataType("double");
				
				if (wrap !== false)
					bin = Converter._variableUnwrapLength(bin);

				var isMinus = bin.substr(0 ,1) == 1;

				var exponentByte = parseInt("0" + bin.substr(1, 7), 2);
				var baseLong = parseInt( bin.substr(8, bin.length), 2);

				var dbl = parseFloat(baseLong+"E-"+exponentByte, 10);
				if (isMinus) dbl = dbl * -1;

				return dbl;
			},
			"long": function ConverterBinaryToLong(bin) {
				return parseInt(bin.substr(0, 32), 2);
			},
			"short": function ConverterBinaryToShort(bin) {
				return parseInt(bin.substr(0, 16), 2);
			},
			"byte": function ConverterBinaryToByte(bin) {
				return parseInt(bin.substr(0, 8), 2);
			},
			"half": function ConverterBinaryToHalf(bin) {
				return parseInt(bin.substr(0, 4), 2);
			},
			"boolean": function ConverterBinaryToBoolean(bin) {
				return bin.substr(0,1) == "1" ? true: false;
			},
			"number": function ConverterBinaryToNumber(bin) {
				return parseInt(bin, 2);
			}
		}
	};
	
	window.SCORMSuspendData = {
		serialize: function SCORMSuspendDataSerialize(arr) {
			return Converter ("array", "base64", arr);
		},
		deserialize: function SCORMSuspendDataDeserialize(base64) {
			return Converter("base64", "array", base64);
		},
		Base64: Base64,
		Converter: Converter,
		DataType: DataType
	};


})(_);

define("extensions/adapt-contrib-spoor/js/serializers/scormSuspendDataSerializer", function(){});

define('extensions/adapt-contrib-spoor/js/serializers/questions',[
    'coreJS/adapt',
    './scormSuspendDataSerializer'
], function (Adapt) {

    //Captures the completion status and user selections of the question components
    //Returns and parses a base64 style string
    var includes = {
        "_isQuestionType": true,
        "_isResetOnRevisit": false
    };

    var serializer = {
        serialize: function () {
            return this.serializeSaveState();
        },

        serializeSaveState: function() {
            if (Adapt.course.get('_latestTrackingId') === undefined) {
                var message = "This course is missing a latestTrackingID.\n\nPlease run the grunt process prior to deploying this module on LMS.\n\nScorm tracking will not work correctly until this is done.";
                console.error(message);
                return "";
            }

            var rtn = "";
            try {
                var data = this.captureData();
                if (data.length === 0) return "";
                rtn = SCORMSuspendData.serialize(data);
            } catch(e) {
                console.error(e);
            }

            return rtn;
        },

        captureData: function() {
            var data = [];
            
            var trackingIds = Adapt.blocks.pluck("_trackingId");
            var blocks = {};
            var countInBlock = {};

            for (var i = 0, l = trackingIds.length; i < l; i++) {

                var trackingId = trackingIds[i];
                var blockModel = Adapt.blocks.findWhere({_trackingId: trackingId });
                var componentModels = blockModel.getChildren().where(includes);

                for (var c = 0, cl = componentModels.length; c < cl; c++) {

                    var component = componentModels[c].toJSON();
                    var blockId = component._parentId;

                    if (!blocks[blockId]) {
                        blocks[blockId] = blockModel.toJSON();
                    }

                    var block = blocks[blockId];
                    if (countInBlock[blockId] === undefined) countInBlock[blockId] = -1;
                    countInBlock[blockId]++;

                    var blockLocation = countInBlock[blockId];

                    if (component['_isInteractionComplete'] === false || component['_isComplete'] === false) {
                        //if component is not currently complete skip it
                        continue;
                    }

                    var hasUserAnswer = (component['_userAnswer'] !== undefined);
                    var isUserAnswerArray = (component['_userAnswer'] instanceof Array);


                    var numericParameters = [
                            blockLocation,
                            block['_trackingId'],
                            component['_score'] || 0,
                            component['_attemptsLeft'] || 0
                        ];

                    var booleanParameters = [
                            hasUserAnswer,
                            isUserAnswerArray,
                            component['_isInteractionComplete'],
                            component['_isSubmitted'],
                            component['_isCorrect'] || false
                        ];

                    var dataItem = [
                        numericParameters,
                        booleanParameters
                    ];


                    if (hasUserAnswer) {
                        var userAnswer = isUserAnswerArray ? component['_userAnswer'] : [component['_userAnswer']];

                        var arrayType = SCORMSuspendData.DataType.getArrayType(userAnswer);

                        switch(arrayType.name) {
                        case "string": case "variable":
                            console.log("Cannot store _userAnswers from component " + component._id + " as array is of variable or string type.");
                            continue;
                        }

                        dataItem.push(userAnswer);
                    }

                    data.push(dataItem);

                }

            }

            return data;

        },

        deserialize: function (str) {

            try {
                var data = SCORMSuspendData.deserialize(str);
                this.releaseData( data );
            } catch(e) {
                console.error(e);
            }
            
        },    

        releaseData: function (arr) {
            
            for (var i = 0, l = arr.length; i < l; i++) {
                var dataItem = arr[i];

                var numericParameters = dataItem[0];
                var booleanParameters = dataItem[1];

                var blockLocation = numericParameters[0];
                var trackingId = numericParameters[1];
                var score = numericParameters[2];
                var attemptsLeft = numericParameters[3] || 0;

                var hasUserAnswer = booleanParameters[0];
                var isUserAnswerArray = booleanParameters[1];
                var isInteractionComplete = booleanParameters[2];
                var isSubmitted = booleanParameters[3];
                var isCorrect = booleanParameters[4];

                var block = Adapt.blocks.findWhere({_trackingId: trackingId});
                var components = block.getChildren();
                components = components.where(includes);
                var component = components[blockLocation];

                component.set("_isComplete", true);
                component.set("_isInteractionComplete", isInteractionComplete);
                component.set("_isSubmitted", isSubmitted);
                component.set("_score", score);
                component.set("_isCorrect", isCorrect);
                component.set("_attemptsLeft", attemptsLeft);

                if (hasUserAnswer) {
                    var userAnswer = dataItem[2];
                    if (!isUserAnswerArray) userAnswer = userAnswer[0];

                    component.set("_userAnswer", userAnswer);
                }


            }
        }
    };

    return serializer;
});

define('extensions/adapt-contrib-spoor/js/adapt-stateful-session',[
	'coreJS/adapt',
	'./serializers/default',
	'./serializers/questions'
], function(Adapt, serializer, questions) {

	//Implements Adapt session statefulness
	
	var AdaptStatefulSession = _.extend({

		_sessionID: null,
		_config: null,
		_shouldStoreResponses: false,
		_shouldRecordInteractions: true,

	//Session Begin
		initialize: function() {
			this.getConfig();
			this.restoreSessionState();
			this.assignSessionId();
			this.setupEventListeners();
		},

		getConfig: function() {
			this._config = Adapt.config.has('_spoor')
				? Adapt.config.get('_spoor')
				: false;
			
			this._shouldStoreResponses = (this._config && this._config._tracking && this._config._tracking._shouldStoreResponses);
			
			// default should be to record interactions, so only avoid doing that if _shouldRecordInteractions is set to false
			if (this._config && this._config._tracking && this._config._tracking._shouldRecordInteractions === false) {
				this._shouldRecordInteractions = false;
			}
		},

		saveSessionState: function() {
			var sessionPairs = this.getSessionState();
			Adapt.offlineStorage.set(sessionPairs);
		},

		restoreSessionState: function() {
			var sessionPairs = Adapt.offlineStorage.get();
			var hasNoPairs = _.keys(sessionPairs).length === 0;

			if (hasNoPairs) return;

			if (sessionPairs.completion) serializer.deserialize(sessionPairs.completion);
			if (sessionPairs.questions && this._shouldStoreResponses) questions.deserialize(sessionPairs.questions);
			if (sessionPairs._isCourseComplete) Adapt.course.set('_isComplete', sessionPairs._isCourseComplete);			
			if (sessionPairs._isAssessmentPassed) Adapt.course.set('_isAssessmentPassed', sessionPairs._isAssessmentPassed);
		},

		getSessionState: function() {
			var sessionPairs = {
				"completion": serializer.serialize(),
				"questions": (this._shouldStoreResponses == true ? questions.serialize() : ""),
				"_isCourseComplete": Adapt.course.get("_isComplete") || false,
				"_isAssessmentPassed": Adapt.course.get('_isAssessmentPassed') || false
			};
			return sessionPairs;
		},

		assignSessionId: function () {
			this._sessionID = Math.random().toString(36).slice(-8);
		},

	//Session In Progress
		setupEventListeners: function() {
			this._onWindowUnload = _.bind(this.onWindowUnload, this);
			$(window).on('unload', this._onWindowUnload);

			if (this._shouldStoreResponses) {
				this.listenTo(Adapt.components, 'change:_isInteractionComplete', this.onQuestionComponentComplete);
			}

			if(this._shouldRecordInteractions) {
				this.listenTo(Adapt, 'questionView:recordInteraction', this.onQuestionRecordInteraction);
			}

			this.listenTo(Adapt.blocks, 'change:_isComplete', this.onBlockComplete);
			this.listenTo(Adapt.course, 'change:_isComplete', this.onCompletion);
			this.listenTo(Adapt, 'assessment:complete', this.onAssessmentComplete);
			this.listenTo(Adapt, 'questionView:complete', this.onQuestionComplete);
			this.listenTo(Adapt, 'questionView:reset', this.onQuestionReset);
		},

		onBlockComplete: function(block) {
			this.saveSessionState();
		},

		onQuestionComponentComplete: function(component) {
			if (!component.get("_isQuestionType")) return;

			this.saveSessionState();
		},

		onCompletion: function() {
			if (!this.checkTrackingCriteriaMet()) return;

			this.saveSessionState();
			
			Adapt.offlineStorage.set("status", this._config._reporting._onTrackingCriteriaMet);
		},

		onAssessmentComplete: function(stateModel) {
			Adapt.course.set('_isAssessmentPassed', stateModel.isPass)
			
			this.saveSessionState();

			this.submitScore(stateModel.scoreAsPercent);

			if (stateModel.isPass) {
				this.onCompletion();
			} else if (this._config && this._config._tracking._requireAssessmentPassed) {
				this.submitAssessmentFailed();
			}
		},

		onQuestionRecordInteraction:function(questionView) {
			var id = questionView.model.get('_id');
			var latency = questionView.getLatency();
			var response = questionView.getResponse();
			var responseType = questionView.getResponseType();
			var result = questionView.isCorrect();
			
			Adapt.offlineStorage.set("interaction", id, response, result, latency, responseType);
		},

		submitScore: function(score) {
			if (this._config && !this._config._tracking._shouldSubmitScore) return;
			
			Adapt.offlineStorage.set("score", score, 0, 100);
		},

		submitAssessmentFailed: function() {
			if (this._config && this._config._reporting.hasOwnProperty("_onAssessmentFailure")) {
				var onAssessmentFailure = this._config._reporting._onAssessmentFailure;
				if (onAssessmentFailure === "") return;
					
				Adapt.offlineStorage.set("status", onAssessmentFailure);
			}
		},

		onQuestionComplete: function(questionView) {
			questionView.model.set('_sessionID', this._sessionID);
		},

		onQuestionReset: function(questionView) {
			if (this._sessionID !== questionView.model.get('_sessionID')) {
				questionView.model.set('_isEnabledOnRevisit', true);
			}
		},
		
		checkTrackingCriteriaMet: function() {
			var criteriaMet = false;

			if (!this._config) {
				return false;
			}

			if (this._config._tracking._requireCourseCompleted && this._config._tracking._requireAssessmentPassed) { // user must complete all blocks AND pass the assessment
				criteriaMet = (Adapt.course.get('_isComplete') && Adapt.course.get('_isAssessmentPassed'));
			} else if (this._config._tracking._requireCourseCompleted) { //user only needs to complete all blocks
				criteriaMet = Adapt.course.get('_isComplete');
			} else if (this._config._tracking._requireAssessmentPassed) { // user only needs to pass the assessment
				criteriaMet = Adapt.course.get('_isAssessmentPassed');
			}

			return criteriaMet;
		},

	//Session End
		onWindowUnload: function() {
			$(window).off('unload', this._onWindowUnload);

			this.stopListening();
		}
		
	}, Backbone.Events);

	return AdaptStatefulSession;

});

define('extensions/adapt-contrib-spoor/js/adapt-offlineStorage-scorm',[
	'coreJS/adapt',
	'./scorm',
	'coreJS/offlineStorage'
], function(Adapt, scorm) {

	//SCORM handler for Adapt.offlineStorage interface.

	//Stores to help handle posting and offline uniformity
	var temporaryStore = {};
	var suspendDataStore = {};
	var suspendDataRestored = false;

	Adapt.offlineStorage.initialize({

		get: function(name) {
			if (name === undefined) {
				//If not connected return just temporary store.
				if (this.useTemporaryStore()) return temporaryStore;

				//Get all values as a combined object
				suspendDataStore = this.getCustomStates();

				var data = _.extend(_.clone(suspendDataStore), {
					location: scorm.getLessonLocation(),
					score: scorm.getScore(),
					status: scorm.getStatus(),
					student: scorm.getStudentName()
				});

				suspendDataRestored = true;
				
				return data;
			}

			//If not connected return just temporary store value.
			if (this.useTemporaryStore()) return temporaryStore[name];

			//Get by name
			switch (name.toLowerCase()) {
				case "location":
					return scorm.getLessonLocation();
				case "score":
					return scorm.getScore();
				case "status":
					return scorm.getStatus();
				case "student":
					return scorm.getStudentName();
				default:
					return this.getCustomState(name);
			}
		},

		set: function(name, value) {
			//Convert arguments to array and drop the 'name' parameter
			var args = [].slice.call(arguments, 1);
			var isObject = typeof name == "object";

			if (isObject) {
				value = name;
				name = "suspendData";
			}

			if (this.useTemporaryStore()) {
				if (isObject) {
					temporaryStore = _.extend(temporaryStore, value);
				} else {
					temporaryStore[name] = value;
				}

				return true;
			}

			switch (name.toLowerCase()) {
				case "interaction":
					return scorm.recordInteraction.apply(scorm, args);
				case "location":
					return scorm.setLessonLocation.apply(scorm, args);
				case "score":
					return scorm.setScore.apply(scorm, args);
				case "status":
					return scorm.setStatus.apply(scorm, args);
				case "student":
					return false;
				case "suspenddata":
				default:
					if (isObject) {
						suspendDataStore = _.extend(suspendDataStore, value);
					} else {
						suspendDataStore[name] = value;
					}

					var dataAsString = JSON.stringify(suspendDataStore);
					return (suspendDataRestored) ? scorm.setSuspendData(dataAsString) : false;
			}
		},

		getCustomStates: function() {
			var isSuspendDataStoreEmpty = _.isEmpty(suspendDataStore);
			if (!isSuspendDataStoreEmpty && suspendDataRestored) return _.clone(suspendDataStore);

			var dataAsString = scorm.getSuspendData();
			if (dataAsString === "" || dataAsString === " " || dataAsString === undefined) return {};

			var dataAsJSON = JSON.parse(dataAsString);
			if (!isSuspendDataStoreEmpty && !suspendDataRestored) dataAsJSON = _.extend(dataAsJSON, suspendDataStore);
			return dataAsJSON;
		},

		getCustomState: function(name) {
			var dataAsJSON = this.getCustomStates();
			return dataAsJSON[name];
		},
		
		useTemporaryStore: function() {
			var cfg = Adapt.config.get('_spoor');
			
			if (!scorm.lmsConnected || (cfg && cfg._isEnabled === false)) return true;
			return false;
		}
		
	});

});

define('extensions/adapt-contrib-spoor/js/adapt-contrib-spoor',[
  'coreJS/adapt',
  './scorm',
  './adapt-stateful-session',
  './adapt-offlineStorage-scorm'
], function(Adapt, scorm, adaptStatefulSession) {

  //SCORM session manager

  var Spoor = _.extend({

    _config: null,

  //Session Begin

    initialize: function() {
      this.listenToOnce(Adapt, "configModel:dataLoaded", this.onConfigLoaded);
      this.listenToOnce(Adapt, "app:dataReady", this.onDataReady);
    },

    onConfigLoaded: function() {
      if (!this.checkConfig()) return;

      this.configureAdvancedSettings();

      scorm.initialize();

      this.setupEventListeners();
    },

    onDataReady: function() {
      adaptStatefulSession.initialize();
    },

    checkConfig: function() {
      this._config = Adapt.config.has('_spoor') 
        ? Adapt.config.get('_spoor')
        : false;

      if (this._config && this._config._isEnabled !== false) return true;
      
      return false;
    },

    configureAdvancedSettings: function() {
      if(this._config._advancedSettings) {
        var settings = this._config._advancedSettings;

        if(settings._showDebugWindow) scorm.showDebugWindow();

        scorm.setVersion(settings._scormVersion || "1.2");

        if(settings.hasOwnProperty("_suppressErrors")) {
          scorm.suppressErrors = settings._suppressErrors;
        }

        if(settings.hasOwnProperty("_commitOnStatusChange")) {
          scorm.commitOnStatusChange = settings._commitOnStatusChange;
        }

        if(settings.hasOwnProperty("_timedCommitFrequency")) {
          scorm.timedCommitFrequency = settings._timedCommitFrequency;
        }

        if(settings.hasOwnProperty("_maxCommitRetries")) {
          scorm.maxCommitRetries = settings._maxCommitRetries;
        }

        if(settings.hasOwnProperty("_commitRetryDelay")) {
          scorm.commitRetryDelay = settings._commitRetryDelay;
        }
      } else {
        /**
        * force use of SCORM 1.2 by default - some LMSes (SABA/Kallidus for instance) present both APIs to the SCO and, if given the choice,
        * the pipwerks code will automatically select the SCORM 2004 API - which can lead to unexpected behaviour.
        */
        scorm.setVersion("1.2");
      }

      /**
      * suppress SCORM errors if 'nolmserrors' is found in the querystring
      */
      if(window.location.search.indexOf('nolmserrors') != -1) scorm.suppressErrors = true;
    },

    setupEventListeners: function() {
      this._onWindowUnload = _.bind(this.onWindowUnload, this);
      $(window).on('unload', this._onWindowUnload);
    },

  //Session End

    onWindowUnload: function() {
      scorm.finish();

      $(window).off('unload', this._onWindowUnload);
    }
    
  }, Backbone.Events);

  Spoor.initialize();

});

define('extensions/adapt-contrib-trickle/js/Defaults/DefaultTrickleConfig',[],function() {

	var DefaultTrickleConfig = {
		_isEnabled: true,
		_scrollDuration: 500,
		_autoScroll: true,
		_onChildren: true,
		_button: {
			_isEnabled: true,
			_isFullWidth: true,
			_styleBeforeCompletion: "hidden",
			_styleAfterClick: "hidden",
			_autoHide: true,
			text: "Continue",
			_component: "trickle-button"
		},
		_stepLocking: {
	        _isEnabled: true, 
	        _isCompletionRequired: true,
	        _isLockedOnRevisit: false
	    },
	    _isInteractionComplete: false,
	    _scrollTo: "@block +1"
	};

	return DefaultTrickleConfig;
});
define('extensions/adapt-contrib-trickle/js/DataTypes/StructureType',[],function() {
	
	function StructureType(id, plural, level) {
		this._id = id;
		this._plural = plural;
		this._level = level;
		StructureType.levels+=1;
	}
	StructureType.levels = 0;

	StructureType.prototype = {};

	StructureType.prototype.toString = function() {
		return this._id;
	};

	StructureType.fromString = function(value) {
		switch (value) {
		case StructureType.Page._id: case StructureType.Page._plural:
			return StructureType.Page;
		case StructureType.Article._id: case StructureType.Article._plural:
			return StructureType.Article;
		case StructureType.Block._id: case StructureType.Block._plural:
			return StructureType.Block;
		case StructureType.Component._id: case StructureType.Component._plural:
			return StructureType.Component;
		}
	};

	StructureType.fromInt = function(value) {
		switch (value) {
		case StructureType.Page._level: 
			return StructureType.Page;
		case StructureType.Article._level: 
			return StructureType.Article;
		case StructureType.Block._level: 
			return StructureType.Block;
		case StructureType.Component._level: 
			return StructureType.Component;
		}
	};

	StructureType.Page = new StructureType("page", "pages", 1);
	StructureType.Article = new StructureType("article", "articles", 2);
	StructureType.Block = new StructureType("block", "blocks", 3);
	StructureType.Component = new StructureType("component", "components", 4);

	return StructureType;

});
define('extensions/adapt-contrib-trickle/js/Utility/Models',[
    'coreJS/adapt',
    '../DataTypes/StructureType'
], function(Adapt, StructureType) {

    var ModelUtilities = {
        
        /*
        * Fetchs the sub structure of an id as a flattened array
        *
        *   Such that the tree:
        *       { a1: { b1: [ c1, c2 ], b2: [ c3, c4 ] }, a2: { b3: [ c5, c6 ] } }
        *
        *   will become the array (parent first = false):
        *       [ c1, c2, b1, c3, c4, b2, a1, c5, c6, b3, a2 ]
        *
        *   or (parent first = true):
        *       [ a1, b1, c1, c2, b2, c3, c4, a2, b3, c5, c6 ]
        *
        * This is useful when sequential operations are performed on the page/article/block/component hierarchy.
        */
        getDescendantsFlattened: function(id, parentFirst) {
            var model = Adapt.findById(id);
            if (model === undefined) return undefined;

            var descendants = [];

            var modelStructureType = StructureType.fromString(model.get("_type"));
            var isLastType = (modelStructureType._level === StructureType.levels);

            if (isLastType) {
                descendants.push(model);
                return new Backbone.Collection(descendants);
            }

            var children = model.getChildren();

            for (var i = 0, l = children.models.length; i < l; i++) {

                var child = children.models[i];

                var modelStructureType = StructureType.fromString(child.get("_type"));
                var isLastType = (modelStructureType._level === StructureType.levels);

                if (isLastType) {

                    descendants.push(child);

                } else {

                    var subDescendants = ModelUtilities.getDescendantsFlattened(child.get("_id"), parentFirst);
                    if (parentFirst == true) descendants.push(child);
                    descendants = descendants.concat(subDescendants.models);
                    if (parentFirst != true) descendants.push(child);

                }

            }

            return new Backbone.Collection(descendants);
        },

        /*
        * Returns a relative structural item from the Adapt hierarchy
        *   
        *   Such that in the tree:
        *       { a1: { b1: [ c1, c2 ], b2: [ c3, c4 ] }, a2: { b3: [ c5, c6 ] } }
        *
        *       findRelative(modelC1, "@block +1") = modelB2;
        *       findRelative(modelC1, "@component +4") = modelC5;
        *
        */
        findRelative: function(model, relativeString) {
            //return a model relative to the specified one
            var pageModel;
            if (model.get("_type") == "page") pageModel = model;
            else pageModel = model.findAncestor("contentObjects");

            var pageId = pageModel.get("_id");
            var pageDescendants = ModelUtilities.getDescendantsFlattened(pageId).toJSON();

            function parseRelative(relativeString) {
                var type = relativeString.substr(0, _.indexOf(relativeString, " "));
                var offset = parseInt(relativeString.substr(type.length));
                type = type.substr(1);

                /*RETURN THE TYPE AND OFFSET OF THE SCROLLTO
                * "@component +1"  : 
                * {
                *       type: "component",
                *       offset: 1
                * }
                */
                return { 
                    type: type,
                    offset: offset
                };
            }

            function getTypeOffset(model) {
                var modelType = StructureType.fromString(model.get("_type"));

                //CREATE HASH FOR MODEL OFFSET IN PARENTS ACCORDING TO MODEL TYPE
                var offsetCount = {};
                for (var i = modelType._level - 1, l = 0; i > l; i--) {
                    offsetCount[StructureType.fromInt(i)._id] = -1;
                }

                return offsetCount;
            }

            var pageDescendantIds = _.pluck(pageDescendants, "_id");

            var modelId = model.get("_id");
            var fromIndex = _.indexOf( pageDescendantIds, modelId );

            var typeOffset = getTypeOffset(model);
            var relativeInstructions = parseRelative(relativeString);

            for (var i = fromIndex +1, l = pageDescendants.length; i < l; i++) {
                var item = pageDescendants[i];

                if (!typeOffset[item._type]) typeOffset[item._type] = 0;

                typeOffset[item._type]++;

                if (typeOffset[relativeInstructions.type] >= relativeInstructions.offset) {
                    if (!$("."+item._id).is(":visible")) {
                        //IGNORE VISIBLY HIDDEN ELEMENTS
                        relativeInstructions.offset++;
                        continue;
                    }

                    return Adapt.findById(item._id);
                }
            }

            return undefined;
        },

        isLastStructureType: function(model) {
            var modelStructureType = StructureType.fromString(model.get("_type"));
            var isLastType = (modelStructureType._level === StructureType.levels);
            return isLastType;
        }
    };

    return ModelUtilities;

});

define('extensions/adapt-contrib-trickle/js/trickle-tutorPlugin',[
    'coreJS/adapt', 
], function(Adapt) {

    var TrickleTutorPlugin = _.extend({

        onDataReady: function() {
            this.setupEventListeners();
        },

        onStepLockingWaitCheck: function(model) {
            if ( model.get("_type") !== "component" || !model.get("_isQuestionType") || !model.get("_canShowFeedback")) return;

            if (this._isTrickleWaiting) return;
            Adapt.trigger("steplocking:wait");
            this._isTrickleWaiting = true;
        },

        onTutorOpened: function() {
            if (this._isTrickleWaiting) return;
            Adapt.trigger("steplocking:wait");
        },

        onTutorClosed: function() {

            if (!this._isTrickleWaiting) return;

            Adapt.trigger("steplocking:unwait");
            this._isTrickleWaiting = false;
        },

        _isTrickleWaiting: false,

        initialize: function() {
            this.listenToOnce(Adapt, "app:dataReady", this.onDataReady);
        },

        setupEventListeners: function() {
            this.listenTo(Adapt, "steplocking:waitCheck", this.onStepLockingWaitCheck);
            this.listenTo(Adapt, "tutor:open", this.onTutorOpened);
            this.listenTo(Adapt, "tutor:closed", this.onTutorClosed);
        }

    }, Backbone.Events);

    TrickleTutorPlugin.initialize();

})
;
define('extensions/adapt-contrib-trickle/js/trickle-buttonView',[
    'coreJS/adapt',
    'coreViews/componentView'
], function(Adapt, ComponentView) {

    var completionAttribute = "_isInteractionComplete";

    var TrickleButtonView = ComponentView.extend({

        onEnabledChange: function(model, value) {
            this.setDisabledState(!value);
        },

        onSteplockingCheckWait: function(parentModel) {
            this.checkCurrentInteraction(parentModel);
        },

        onInteractionRequired: function(parentModel) {
            this.showButton(parentModel); 
        },

        onOnScreen: function() {
            //show or hide the button when button is inview/outview
            this.checkAutoHide( this.isOnScreen() );
        },

        onClick: function() {
            if (!this.model.get("_isLocking")) {
                this.completeJump();
            } else {
                this.completeLock();
            }
        },

        onRemove: function() {
            this.undelegateEvents();
            this.$el.remove();
        },

        events: {
            "click .trickle-button-inner > *": "onClick",
            "onscreen": "onOnScreen"
        },

        _isTrickleWaiting: false,

        initialize: function() {
            var trickleConfig = Adapt.config.get("_trickle");
            if (trickleConfig && trickleConfig._completionAttribute) completionAttribute = trickleConfig._completionAttribute;

            this.addCustomClasses();
            ComponentView.prototype.initialize.apply(this);

            this.model.set("_isEnabled", this.isInEnabledState());

            this.checkAutoHide(this.isInVisibleState(), false);
        },

        addCustomClasses: function() {
            if (!this.model.get("_trickle")._button || !this.model.get("_trickle")._button._className) return;
            
            this.$el.addClass(this.model.get("_trickle")._button._className);
        },

        postRender: function() {
            this.setDisabledState( !this.isInEnabledState() );

            this.setReadyStatus();
            this.setupEventListeners();
        },

        setDisabledState: function(bool) {
            if (bool) this.$el.find(".trickle-button-inner > *").addClass("disabled").attr("disabled","disabled");
            else this.$el.find(".trickle-button-inner > *").removeClass("disabled").removeAttr("disabled");
        },

        setupEventListeners: function() {

            var trickleConfig = this.model.get("_trickle");
            if (!trickleConfig._button._autoHide) this.$el.off("onscreen");

            this.listenTo(Adapt, "trickle:interactionRequired", this.onInteractionRequired);
            this.listenTo(Adapt, "steplocking:waitCheck", this.onSteplockingCheckWait);
            this.listenTo(this.model, "change:_isEnabled", this.onEnabledChange);
            this.listenTo(this.model, "change:_isVisible", this.onVisibilityChange);
            this.listenToOnce(Adapt, "remove", this.onRemove);
            this.listenToOnce(Adapt, "trickle:kill", this.onRemove);
        },

        toggleLock: function(bool) {
            if (!this.isStepLockingEnabled()) return;

            var trickleConfig = this.model.get("_trickle");

            if (bool) {

                this.$el.find('.component-inner').addClass("locking");

                this.model.set("_isLocking", true);

                this.steplockingWait();

            } else {

                this.$el.find('.component-inner').removeClass("locking");

                this.model.set("_isLocking", false);

                this.steplockingUnwait();
            }
        },

        isStepLockingEnabled: function() {
            var trickleConfig = this.model.get("_trickle");
            if (trickleConfig && trickleConfig._stepLocking && trickleConfig._stepLocking._isEnabled) {
                return true;
            }
            return false;
        },

        steplockingWait: function() {
            if (!this._isTrickleWaiting) Adapt.trigger("steplocking:wait");
            this._isTrickleWaiting = true;
        },

        steplockingUnwait: function() {
            if (this._isTrickleWaiting) Adapt.trigger("steplocking:unwait");
            this._isTrickleWaiting = false;
        },

        checkCurrentInteraction: function(parentModel) {
            if (parentModel.get("_id") != this.model.get("_parentId")) return;

            var trickleConfig = this.model.get("_trickle");

            if (trickleConfig._isInteractionComplete) return;

            this.model.set("_isEnabled", this.isInEnabledState() );
        },

        showButton: function(parentModel) {
            //check if the interaction required event is intended for this button
            if (parentModel.get("_id") != this.model.get("_parentId")) return;

            var trickleConfig = this.model.get("_trickle");

            if (trickleConfig._isInteractionComplete) return;

            this.model.set("_isEnabled",  this.isInEnabledState() );

            this.toggleLock(true);

            this.checkAutoHide(true, true);
        },

        checkAutoHide: function(bool, animate) {
            
            if (!this.isInVisibleState()) {
                //override visible state if button should not be visible
                bool = false;
            }

            this.model.set("_isVisible", bool);

            var trickleConfig = this.model.get("_trickle");
            if (!trickleConfig._button._autoHide) return;

            if (this.model.get("_isHidden") == bool) return;

            this.model.set("_isHidden", bool);

            if (animate === false || Adapt.config.get('_disableAnimation')) {
                //show or hide without animations
                if (!bool) this.$('.component-inner').css("visibility", "hidden");
                else if (bool) this.$('.component-inner').css("visibility", "visible");
            } else {
                //perform animation from visible<>hidden
                if (bool) this.$('.component-inner').css("visibility", "visible");
                this.$('.component-inner').velocity("stop", true).velocity({opacity: bool ? 1 : 0 }, {
                    duration: 250,
                    complete: _.bind(function() {
                        if (!bool) this.$('.component-inner').css("visibility", "hidden");
                    }, this)
                })
            }
            
        },

        isInEnabledState: function() {
            var trickleConfig = this.model.get("_trickle");

            var _isEnabled = true;

            var isEnabledBeforeCompletion = false;
            //Check to see if autohide component should always be visible or if it has a precompletion hidden state
            if (trickleConfig._button._styleBeforeCompletion == "visible") {
                isEnabledBeforeCompletion = (!trickleConfig._stepLocking._isEnabled || !trickleConfig._stepLocking._isCompletionRequired);
            }

            var isEnabledAfterClick = (trickleConfig._button._styleAfterClick != "hidden" && trickleConfig._button._styleAfterClick != "disabled");

            var parentModel = Adapt.findById(this.model.get("_parentId"));
            var isComplete = parentModel.get(completionAttribute);
            var isClicked = trickleConfig._isInteractionComplete;

            var isBeforeCompletionEnabled = (!isComplete && !isClicked && isEnabledBeforeCompletion);
            var isAfterCompletionEnabled = (isClicked && isEnabledAfterClick);
            var isInInteractionEnabled = (isComplete && !isClicked);

            _isEnabled = isBeforeCompletionEnabled || isAfterCompletionEnabled || isInInteractionEnabled;

            return _isEnabled;
        },

        isInVisibleState: function() {
            var trickleConfig = this.model.get("_trickle");

            var _isVisible = true;

            var isVisibleBeforeCompletion = true;
            //Check to see if autohide component should always be visible or if it has a precompletion hidden state
            if (trickleConfig._button._styleBeforeCompletion == "hidden") {
                isVisibleBeforeCompletion = (trickleConfig._button._styleBeforeCompletion != "hidden");
            }

            var isVisibleAfterClick = (trickleConfig._button._styleAfterClick != "hidden");

            var parentModel = Adapt.findById(this.model.get("_parentId"));
            var isComplete = parentModel.get(completionAttribute);
            var isClicked = trickleConfig._isInteractionComplete;

            var isOnScreen = true;
            if (trickleConfig._button._autoHide) {
                isOnScreen = this.isOnScreen();
            }

            var isBeforeCompletionVisible = (!isComplete && !isClicked && isVisibleBeforeCompletion && isOnScreen);
            var isInInteractionVisible = (isComplete && !isClicked && isOnScreen);
            var isAfterCompletionVisible = (isClicked && isVisibleAfterClick && isOnScreen);

            _isVisible = isBeforeCompletionVisible || isAfterCompletionVisible || isInInteractionVisible;


            return _isVisible;

        },

        isOnScreen: function() {
            var onscreen = false;
            var measurements = this.$el.onscreen();
            var parent = this.$el.offsetParent();
            var isParentHtml = parent.is("html");
            if (!isParentHtml && measurements.bottom > -(this.$(".component-inner").outerHeight()*2)) {
                onscreen = true;
            }
            return onscreen;
        },

        completeJump: function() {

            var trickleConfig = this.model.get("_trickle");
            trickleConfig._isInteractionComplete = true;

            this.updateState();

            this.scrollTo();
        },

        updateState: function() {

            var trickleConfig = this.model.get("_trickle");

            switch (trickleConfig._button._styleAfterClick) {
            case "disabled": case "hidden":
                this.model.set("_isEnabled", this.isInEnabledState() );
                this.$el.off("onscreen");
                this.stopListening();
                break;
            case "scroll":
                this.model.set("_isEnabled", this.isInEnabledState() );
                break;
            }

            this.checkAutoHide(true, true);
        },

        scrollTo: function() {
            var trickleConfig = this.model.get("_trickle");
            var scrollTo = trickleConfig._scrollTo;
            var parentModel = Adapt.findById(this.model.get("_parentId"));
            Adapt.trigger("trickle:relativeScrollTo", parentModel, scrollTo);
        },

        completeLock: function() {

            var trickleConfig = this.model.get("_trickle");
            trickleConfig._isInteractionComplete = true;

            this.toggleLock(false);

            //as this is an 'out-of-course' component, 
            //we must manually ask trickle to consider the completion of its parent (possibly for a second time)
            var parentModel = Adapt.findById(this.model.get("_parentId"));
            Adapt.trigger("trickle:interactionComplete", parentModel);
            
            this.updateState();
        }

    });

    Adapt.register("trickle-button", TrickleButtonView);

    return TrickleButtonView;
});

define('extensions/adapt-contrib-trickle/js/Defaults/FullWidthButtonConstants',[],function() {

	var FullWidthButtonConstants = {
		_stepLocking: {
			_isEnabled: true
		}
	};
	
	return FullWidthButtonConstants;
});
define('extensions/adapt-contrib-trickle/js/trickle-buttonModel',[
    'coreModels/adaptModel',
    './Defaults/FullWidthButtonConstants'
], function(AdaptModel, FullWidthButtonConstants) {

    var TrickleButtonModel = AdaptModel.extend({
        
        initialize: function(options) {
            if (options.trickleConfig === undefined) return;
            if (options.parentModel === undefined) return;

            var parentModel = options.parentModel;
            var trickleConfig = options.trickleConfig;

            var isFullWidth = (trickleConfig._button._isFullWidth);
            if (isFullWidth) {
                //setup configuration with FullWidth type constants
                $.extend(true, trickleConfig, FullWidthButtonConstants);
            }

            this.setupButtonText(trickleConfig);

            this.set({
                _id: "trickle-button-"+parentModel.get("_id"),
                _type: "component",
                _component: "trickle-button",
                //turn off accessibility state for button component
                _classes: "no-state" + (isFullWidth ? " trickle-full-width" : ""),
                _layout: "full",
                _parentId: parentModel.get("_id"),
                _parentType: parentModel.get("_type"),
                _parentComponent: parentModel.get("_component"),
                _trickle: trickleConfig,
                _isVisible: true,
                _isHidden: false,
                _isAvailable: true,
                _isEnabled: true,
                _isLocking: trickleConfig._isLocking,
                _isComplete: trickleConfig._isInteractionComplete,
                _isInteractionComplete: trickleConfig._isInteractionComplete,
                _index: trickleConfig._index
            });

        },

        setupButtonText: function(trickleConfig) {
            if (trickleConfig._isLastItem) {
                //Apply final text to last button
                if (trickleConfig._button && trickleConfig._button.finalText) {
                    var previousText = trickleConfig._button.text;

                    trickleConfig._button.text = trickleConfig._button.finalText,
                    trickleConfig._button.previousText = previousText;
                }
            } else {
                //Reset button to previous text
                if (trickleConfig && trickleConfig._button.previousText) {
                    trickleConfig._button.text = trickleConfig._button.previousText;
                    trickleConfig._button.previousText = null;
                }
            }
        }

    });

    return TrickleButtonModel;

});
define('extensions/adapt-contrib-trickle/js/trickle-buttonPlugin',[
    'coreJS/adapt',
    './trickle-buttonView',
    './trickle-buttonModel'
], function(Adapt, TrickleButtonView, TrickleButtonModel) {

    var completionAttribute = "_isInteractionComplete";

    var TrickleButtonPlugin = {
        
        onInteractionInitialize: function(model) {
            var trickleConfig = Adapt.config.get("_trickle");
            if (trickleConfig && trickleConfig._completionAttribute) completionAttribute = trickleConfig._completionAttribute;

            TrickleButtonPlugin.createButton(model);
        },

        createButton: function(model) {
            var trickleConfig = model.get("_trickle");
            if (!trickleConfig) return false;

            if (!TrickleButtonPlugin.shouldRenderButton(model, trickleConfig)) return;
            TrickleButtonPlugin.buildAndAppendButton(model, trickleConfig);
        },

        shouldRenderButton: function(model, trickleConfig) {
            if (!trickleConfig._button._isEnabled) return false;
            if (!trickleConfig._button._component == "trickle-button") return false;

            return true;
        },

        buildAndAppendButton: function(model, trickleConfig) {
            var $containerModelElement = $("." + trickleConfig._id);

            var buttonModel = new TrickleButtonModel({ 
                trickleConfig: trickleConfig, 
                parentModel: model 
            });

            var buttonView = new TrickleButtonView({ 
                model: buttonModel, 
                nthChild: "additional" 
            });

            $containerModelElement.append( buttonView.$el );
        }
    };

    Adapt.on("trickle:interactionInitialize", TrickleButtonPlugin.onInteractionInitialize);

    return TrickleButtonPlugin;
});
//https://github.com/cgkineo/jquery.resize 2015-08-13

(function() {

  if ($.fn.off.elementResizeOriginalOff) return;


  var orig = $.fn.on;
  $.fn.on = function () {
    if (arguments[0] !== "resize") return $.fn.on.elementResizeOriginalOn.apply(this, _.toArray(arguments));
    if (this[0] === window) return $.fn.on.elementResizeOriginalOn.apply(this, _.toArray(arguments));

    addResizeListener.call(this, (new Date()).getTime());

    return $.fn.on.elementResizeOriginalOn.apply(this, _.toArray(arguments));
  };
  $.fn.on.elementResizeOriginalOn = orig;
  var orig = $.fn.off;
  $.fn.off = function () {
    if (arguments[0] !== "resize") return $.fn.off.elementResizeOriginalOff.apply(this, _.toArray(arguments));
    if (this[0] === window) return $.fn.off.elementResizeOriginalOff.apply(this, _.toArray(arguments));

    removeResizeListener.call(this, (new Date()).getTime());

    return $.fn.off.elementResizeOriginalOff.apply(this, _.toArray(arguments));
  };
  $.fn.off.elementResizeOriginalOff = orig;

  var expando = $.expando;

  //element + event handler storage
  var resizeObjs = {};

  //jQuery element + event handler attachment / removal
  var addResizeListener = function(data) {
      resizeObjs[data.guid + "-" + this[expando]] = { 
        data: data, 
        $element: $(this) 
      };
  };

  var removeResizeListener = function(data) {
    try { 
      delete resizeObjs[data.guid + "-" + this[expando]]; 
    } catch(e) {

    }
  };

  function checkLoopExpired() {
    if ((new Date()).getTime() - loopData.lastEvent > 500) {
      stopLoop()
      return true;
    }
  }

  function resizeLoop () {
    if (checkLoopExpired()) return;

    var resizeHandlers = getEventHandlers("resize");

    if (resizeHandlers.length === 0) {
      //nothing to resize
      stopLoop();
      resizeIntervalDuration = 500;
      repeatLoop();
    } else {
      //something to resize
      stopLoop();
      resizeIntervalDuration = 250;
      repeatLoop();
    }

    if  (resizeHandlers.length > 0) {
      var items = resizeHandlers;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        triggerResize(item);
      }
    }

  }

  function getEventHandlers(eventName) {
    var items = [];
    
    switch (eventName) {
    case "resize":
      for (var k in resizeObjs) {
        items.push(resizeObjs[k]);
      }
      break;
    }

    return items;
  }

  function getDimensions($element) {
      var height = $element.outerHeight();
      var width = $element.outerWidth();

      return {
        uniqueMeasurementId: height+","+width
      };
  }

  function triggerResize(item) {
    var measure = getDimensions(item.$element);
    //check if measure has the same values as last
    var isFirstRun = false;
    if (item._resizeData === undefined) isFirstRun = true;
    if (item._resizeData !== undefined && item._resizeData === measure.uniqueMeasurementId) return;
    item._resizeData = measure.uniqueMeasurementId;
    if (isFirstRun) return;
    
    //make sure to keep listening until no more resize changes are found
    loopData.lastEvent = (new Date()).getTime();
    
    item.$element.trigger('resize');
  }


  //checking loop interval duration
  var resizeIntervalDuration = 250;

  var loopData = {
    lastEvent: 0,
    interval: null
  };

  //checking loop start and end
  function startLoop() {
    loopData.lastEvent = (new Date()).getTime();
    if (loopData.interval !== null) {
      stopLoop();
    }
    loopData.interval = setTimeout(resizeLoop, resizeIntervalDuration);
  }

  function repeatLoop() {
    if (loopData.interval !== null) {
      stopLoop();
    }
    loopData.interval = setTimeout(resizeLoop, resizeIntervalDuration);
  }

  function stopLoop() {
    clearInterval(loopData.interval);
    loopData.interval = null;
  }

  $('body').on("mousedown mouseup keyup keydown", startLoop);
  $(window).on("resize", startLoop);


})();

define("extensions/adapt-contrib-trickle/js/lib/jquery.resize", function(){});

define('extensions/adapt-contrib-trickle/js/adapt-contrib-trickle',[
    'coreJS/adapt',
    './Defaults/DefaultTrickleConfig',
    './Utility/Models',
    './trickle-tutorPlugin',
    './trickle-buttonPlugin',
    './lib/jquery.resize'
], function(Adapt, DefaultTrickleConfig, Models) {

    var completionAttribute = "_isInteractionComplete";

    var Trickle = _.extend({

        onDataReady: function() {
            var trickleConfig = Adapt.config.get("_trickle");
            if (trickleConfig && trickleConfig._completionAttribute) completionAttribute = trickleConfig._completionAttribute;

            this.setupEventListeners();
        },

        onPagePreRender: function(view) {
            this.initializePage(view);
        },

        onArticlePreRender: function(view) {
            this.checkApplyTrickleToChildren( view.model );
        },

        onPagePostRender: function(view) {
            this.resizeBodyToCurrentIndex();
        },

        onArticleAndBlockPostRender: function(view) {
            this.setupStep( view.model );
        },

        onPageReady: function(view) {
            this.initializeStep();
            this.resizeBodyToCurrentIndex();
            this._listenToResizeEvent = true;
            this._isPageReady = true;
            Adapt.trigger("trickle:pageReady");
        },

        onAnyComplete: function(model, value, isPerformingCompletionQueue) {
            this.queueOrExecuteCompletion(model, value, isPerformingCompletionQueue);
        },

        onStepUnlockWait: function() {
            this._waitForUnlockRequestsCount++;
        },

        onStepUnlockUnwait: function() {
            this._waitForUnlockRequestsCount--;
            if (this._waitForUnlockRequestsCount < 0) this._waitForUnlockRequestsCount = 0;

            if (this._isFinished) return;

            var descendant = this.getCurrentStepModel();
            this.checkStepComplete(descendant);
        },

        onWrapperResize: function() {
            if (!this._listenToResizeEvent) {
                return;
            }

            this.resizeBodyToCurrentIndex();
            this._listenToResizeEvent = true;
        },

        onRemove: function(view) {
            this.endTrickle();
        },


        model: new Backbone.Model({}),

        _listenToResizeEvent: false,
        _isPageInitialized: false,
        _isPageReady: false,
        _isFinished: false,
        _currentStepIndex: 0,
        _descendantsChildrenFirst: null,
        _descendantsParentFirst: null,
        _pageView: null,
        _isTrickleOn: false,

        initialize: function() {
            this.listenToOnce(Adapt, "app:dataReady", this.onDataReady);
        },

        setupEventListeners: function() {
            this._onWrapperResize = _.bind(Trickle.onWrapperResize, Trickle);
            $("#wrapper").on('resize', this._onWrapperResize );

            this.listenTo(Adapt, "remove", this.onRemove);
            this.listenTo(Adapt, "pageView:preRender", this.onPagePreRender);
            this.listenTo(Adapt, "pageView:postRender", this.onPagePostRender);
            this.listenTo(Adapt, "pageView:ready", this.onPageReady);

            this.listenTo(Adapt, "articleView:preRender", this.onArticlePreRender);
            this.listenTo(Adapt, "blockView:postRender articleView:postRender", this.onArticleAndBlockPostRender);

            this.listenTo(Adapt.articles, "change:"+completionAttribute, this.onAnyComplete);
            this.listenTo(Adapt.blocks, "change:"+completionAttribute, this.onAnyComplete);
            this.listenTo(Adapt.components, "change:"+completionAttribute, this.onAnyComplete);           

            this.listenTo(Adapt, "trickle:interactionComplete", this.checkStepComplete);

            this.listenTo(Adapt, "steplocking:wait", this.onStepUnlockWait);
            this.listenTo(Adapt, "steplocking:unwait", this.onStepUnlockUnwait);

            this.listenTo(Adapt, "trickle:relativeScrollTo", this.relativeScrollTo);

            this.listenTo(Adapt, "trickle:kill", this.endTrickle);
        },

        initializePage: function(view) {
            var pageId = view.model.get("_id");

            var pageConfig = Adapt.course.get("_trickle");
            if (pageConfig && pageConfig._isEnabled === false) return;

            this._descendantsChildrenFirst =  Models.getDescendantsFlattened(pageId);
            this._descendantsParentFirst = Models.getDescendantsFlattened(pageId, true);
            this._currentStepIndex = 0;
            this._isFinished = false;
            this._listenToResizeEvent = false;
            this._pageView = view;

            this.checkResetChildren();

            this.initializeStepUnlockWait();

            this._isPageInitialized = true;

        },

        checkResetChildren: function() {
            var descendantsChildrenFirst = this._descendantsChildrenFirst;
            for (var i = 0, model; model = descendantsChildrenFirst.models[i++];) {
                this.checkResetModel(model);
            }
        },

        checkResetModel: function(model) {
            var trickleConfig = this.getModelTrickleConfig(model);
            if (!trickleConfig) return;
            if (trickleConfig._onChildren) return;

            if (!trickleConfig._stepLocking || !trickleConfig._stepLocking._isEnabled == true) return;      
            
            if (model.get(completionAttribute) && !trickleConfig._isLocking) trickleConfig._isInteractionComplete = true;

            if (!trickleConfig._isInteractionComplete) {
                
                trickleConfig._isLocking = true;

            }

            if (trickleConfig._stepLocking._isLockedOnRevisit || 
                (trickleConfig._stepLocking._isCompletionRequired && !model.get(completionAttribute))) {

                trickleConfig._isInteractionComplete = false;
                trickleConfig._isLocking = true;

            }

        },

        getModelTrickleConfig: function(model) {

            function initializeModelTrickleConfig(model, parent) {
                var trickleConfig = model.get("_trickle");

                var courseConfig = Adapt.course.get("_trickle");
                if (courseConfig && courseConfig._isEnabled === false) return false;

                var trickleConfig = $.extend(true, 
                    {}, 
                    DefaultTrickleConfig, 
                    trickleConfig,
                    { 
                        _id: model.get("_id"), 
                        _areDefaultsSet: true,
                        _index: parent.getModelPageIndex(model)
                    }
                );

                if (model.get("_type") != "article") {
                    trickleConfig._onChildren = false;
                }

                var isLastPageItem = ( trickleConfig._index == parent._descendantsChildrenFirst.length - 2 );
                if (isLastPageItem && model.get("_type") != "article") {
                    return false;
                }

                model.set("_trickle", trickleConfig);

                return true;
            }

            var trickleConfig = model.get("_trickle");
            if (trickleConfig === undefined) return false;

            //if has been initialized already, return;
            if (trickleConfig._areDefaultsSet) return trickleConfig;

            if (!initializeModelTrickleConfig(model, this)) return false;
            
            return model.get("_trickle");
        },

        getModelPageIndex: function(model) {
            var descendants = this._descendantsChildrenFirst.toJSON();
            var pageDescendantIds = _.pluck(descendants, "_id");

            var id = model.get("_id");
            var index = _.indexOf( pageDescendantIds, id );

            return index;
        },

        initializeStepUnlockWait: function() {
            this._waitForUnlockRequestsCount = 0;
        },

        checkApplyTrickleToChildren: function(model) {
            if (model.get("_type") != "article") return;

            var trickleConfig = this.getModelTrickleConfig(model);
            if (!trickleConfig) return;
            if (!trickleConfig._onChildren) return;

            this.applyTrickleToChildren(model, trickleConfig);
        },

        applyTrickleToChildren: function(model, parentTrickleConfig) {
            var children = model.getChildren().models;
            for (var i = 0, l = children.length; i < l; i++) {

                var child = children[i];
                var childTrickleConfig = child.get("_trickle");

                var isLastItem = (i == l - 1);

                var isEnabled = true;
                if (childTrickleConfig) {
                    if (childTrickleConfig._isEnabled === false) {
                        isEnabled = false;
                    }
                }
                if (parentTrickleConfig) {
                    if (parentTrickleConfig._isEnabled === false) {
                        isEnabled = false;
                    }
                }

                var trickleConfig = $.extend(true, 
                    {}, 
                    parentTrickleConfig, 
                    childTrickleConfig, 
                    { 
                        _id: child.get("_id"),
                        _onChildren: false,
                        _isEnabled: isEnabled,
                        _isLastItem: isLastItem,
                        _index: this.getModelPageIndex(child)
                    }
                );

                var isLastPageItem = ( trickleConfig._index == this._descendantsChildrenFirst.length - 2 );
                if (isLastPageItem) {
                    continue;
                }

                child.set("_trickle", trickleConfig);

                this.checkResetModel(child);
                
            }
        },

        resizeBodyToCurrentIndex: function() {
            if (!this._isTrickleOn) return;
            
            if (this._isFinished) return this.showElements();

            this._listenToResizeEvent = false;

            this.showElements();

            var id = this.getCurrentStepModel().get("_id");
            var $element = $("." + id);

            if ($element.length === 0) {
                return;
            }

            var elementOffset = $element.offset();
            var elementBottomOffset = elementOffset.top + $element.outerHeight();

            $('body').css("height", elementBottomOffset + "px");
        },

        showElements: function() {
            if (!this._descendantsParentFirst) return;

            var model = this.getCurrentStepModel();
            var ancestors = this._descendantsParentFirst.models;
            var ancestorIds = _.pluck(this._descendantsParentFirst.toJSON(), "_id");

            var showToId;
            if (model !== undefined) {
                //Not at end of trickle
                showToId = model.get("_id");

                var isLastType = Models.isLastStructureType(model);

                if (!isLastType) {
                    //If current step model is not a component type:
                    //then show components for the selected parent
                    var currentAncestorIndex = _.indexOf(ancestorIds, showToId);
                    var ancestorChildComponents = ancestors[currentAncestorIndex].findDescendants("components");

                    showToId = ancestorChildComponents.models[ancestorChildComponents.models.length-1].get("_id");
                }

            } else {
                //At end, show all ids
                showToId = ancestors[ancestors.length -1].get("_id");
            }
            
            
            var showToIndex = _.indexOf(ancestorIds, showToId);

            for (var i = 0, l = ancestors.length; i < l; i++) {
                var itemModel = ancestors[i];
                if (i <= showToIndex) {
                    itemModel.set("_isVisible", true, { pluginName: "trickle" });
                } else {
                    itemModel.set("_isVisible", false, { pluginName: "trickle" });
                }
            }
            
        },

        getCurrentStepModel: function() {
            if (!this._descendantsChildrenFirst) return;

            return this._descendantsChildrenFirst.models[this._currentStepIndex];
        },

        setupStep: function(model) {
            var trickleConfig = this.getModelTrickleConfig(model)
            if (!trickleConfig) return;
            if (!trickleConfig._isEnabled) return;
            if (trickleConfig._onChildren) return;

            var isStepLocking = this.isModelStepLocking(model);
            trickleConfig._isStepLocking = isStepLocking;

            Adapt.trigger("trickle:interactionInitialize", model);
        },

        initializeStep: function() {
            if (this._isFinished) return;
            this.initializeStepUnlockWait();

            if (this.hasCurrentStepLock()) {
                this.startTrickle();
            } else {
                this.endTrickle();
            }
        },

        hasCurrentStepLock: function() {
            var currentIndex = this._currentStepIndex;
            var descendants = this._descendantsChildrenFirst.models;
            for (var i = currentIndex, l = descendants.length; i < l; i++) {
                var descendant = descendants[i];

                if (!this.isModelStepLocking(descendant)) continue;

                this._currentStepIndex = i;
                

                return true;
            }

            return false;
        },

        isModelStepLocking: function(model) {
            var trickleConfig = this.getModelTrickleConfig(model)
            if (!trickleConfig) return false;
            if (trickleConfig._onChildren) return false;

            if (trickleConfig._isEnabled === false) return false;
            
            if (!trickleConfig._stepLocking || !trickleConfig._stepLocking._isEnabled) return false;
            
            if (trickleConfig._isLocking) return true;
            if (trickleConfig._isInteractionComplete) return false;

            var isComplete = model.get(completionAttribute);
            if (isComplete !== undefined) return !isComplete;

            return true;
        },

        startTrickle: function() {
            this._isTrickleOn = true;
            $("html").addClass("trickle");
            Adapt.trigger("steplocking:waitInitialize");
            this.resizeBodyToCurrentIndex();
            this._listenToResizeEvent = true;
        },

        endTrickle: function() {
            this._currentStepIndex = -1;
            this._isFinished = true;
            $("body").css("height", "");
            $("html").removeClass("trickle");
            this._pageView = null;
            this.resizeBodyToCurrentIndex();
            this._isPageReady = false;
            this._listenToResizeEvent = true;
            this._isTrickleOn = false;
        },

        //completion reorder and processing
        _completionQueue: [],
        queueOrExecuteCompletion: function(model, value, isPerformCompletionQueue) {
            if (value === false) return;    

            if (isPerformCompletionQueue !== true) {
                //article, block and component completion trigger in a,b,c order need in c,b,a order
                //otherwise block completion events will occur before component completion events
                
                var isLastType = Models.isLastStructureType(model);

                if (!isLastType) {
                    //defer completion event handling if not at component level
                    return this._completionQueue.push({
                        model: model,
                        value: value    
                    });
                } else {
                    //if at component level, handle completion queue events after component completion is handled
                    if (this._isPageReady) {
                        _.defer(_.bind(this.performCompletionQueue, this));
                    } else {
                        this.listenToOnce(Adapt, "trickle:pageReady", function(){                            
                            this.performCompletionQueue();
                        });
                    }
                }
            }

            if (this._isPageReady) {
                Adapt.trigger("steplocking:waitCheck", model);
                this.checkStepComplete(model);
            } else {                
                this.listenToOnce(Adapt, "trickle:pageReady", function(){                    
                    Adapt.trigger("steplocking:waitCheck", model);
                    this.checkStepComplete(model);
                });
            }
        },

        performCompletionQueue: function() {
            while (this._completionQueue.length > 0) {
                var item = this._completionQueue.pop();
                this.queueOrExecuteCompletion(item.model, item.value, true);
            }
        },

        checkStepComplete: function(model) {
            if (this._isFinished) return;

            var currentModel = this.getCurrentStepModel();

            //if the model does not match the current trickle item then break
            if (model.get("_id") != currentModel.get("_id")) return;

            var trickleConfig = this.getModelTrickleConfig(model);
            if (!trickleConfig) return;
            
            //if plugins need to present before the interaction then break
            if (this.isStepUnlockWaiting()) return;
            
            //if completion is required and item is not yet complete then break
            if (trickleConfig._stepLocking._isCompletionRequired && !model.get(completionAttribute)) return;

            Adapt.trigger("trickle:interactionRequired", model);
            
            //if plugins need to present before the next step occurs then break
            if (this.isStepUnlockWaiting()) return;

            //set interaction complete
            trickleConfig._isLocking = false;
            trickleConfig._isInteractionComplete = true;

            this.stepComplete(model);
        },

        stepComplete: function(model) {
            this.initializeStep();

            Adapt.trigger('device:resize');

            this.scrollToStep(model);
        },

        scrollToStep: function(model) {
            var trickleConfig = this.getModelTrickleConfig(model);
            if (trickleConfig._autoScroll === false) return;

            var scrollTo = trickleConfig._scrollTo;
            
            //Allows trickle to scroll to a sibling / cousin component relative to the current trickle item
            this.relativeScrollTo( model, scrollTo );
        },

        isStepUnlockWaiting: function() {
            return this._waitForUnlockRequestsCount > 0;
        },
        
        relativeScrollTo: function(model, scrollTo) {
            if (scrollTo === undefined) scrollTo = "@block +1";

            var scrollToId = "";
            switch (scrollTo.substr(0,1)) {
            case "@":
                //NAVIGATE BY RELATIVE TYPE
                
                //Allows trickle to scroll to a sibling / cousin component relative to the current trickle item
                var relativeModel = Models.findRelative(model, scrollTo);
                
                if (relativeModel === undefined) return;
                scrollToId = relativeModel.get("_id");

                break;
            case ".":
                //NAVIGATE BY CLASS
                scrollToId = scrollTo.substr(1, scrollTo.length-1);
                break;
            default: 
                scrollToId = scrollTo;
            }

            if (scrollToId == "") return;
            
            var duration = model.get("_trickle")._scrollDuration || 500;
            _.delay(function() {
                Adapt.scrollTo("." + scrollToId, { duration: duration });
            }, 250);
        }
        
    }, Backbone.Events);

    Trickle.initialize();

    return Trickle;

})
;
define('extensions/adapt-contrib-tutor/js/adapt-contrib-tutor',[
    'coreJS/adapt'
],function(Adapt) {

    Adapt.on('questionView:showFeedback', function(view) {

        var alertObject = {
            title: view.model.get("feedbackTitle"),
            body: view.model.get("feedbackMessage")
        };

        if (view.model.has('_isCorrect')) {
            // Attach specific classes so that feedback can be styled.
            if (view.model.get('_isCorrect')) {
                alertObject._classes = 'correct';
            } else {
                if (view.model.has('_isAtLeastOneCorrectSelection')) {
                    // Partially correct feedback is an option.
                    alertObject._classes = view.model.get('_isAtLeastOneCorrectSelection')
                        ? 'partially-correct'
                        : 'incorrect';
                } else {
                    alertObject._classes = 'incorrect';
                }
            }
        }

        Adapt.once("notify:closed", function() {
            Adapt.trigger("tutor:closed");
        });

        Adapt.trigger('notify:popup', alertObject);

        Adapt.trigger('tutor:opened');
    });

});

define('components/adapt-contrib-accordion/js/adapt-contrib-accordion',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var Accordion = ComponentView.extend({

        events: {
            'click .accordion-item-title': 'toggleItem'
        },

        preRender: function() {
            // Checks to see if the accordion should be reset on revisit
            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.setReadyStatus();
        },

        // Used to check if the accordion should reset on revisit
        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }

            _.each(this.model.get('_items'), function(item) {
                item._isVisited = false;
            });
        },

        toggleItem: function(event) {
            event.preventDefault();
            this.$('.accordion-item-body').stop(true, true).slideUp(200);

            if (!$(event.currentTarget).hasClass('selected')) {
                this.$('.accordion-item-title').removeClass('selected');
                var body = $(event.currentTarget).addClass('selected visited').siblings('.accordion-item-body').slideToggle(200, function() {
                  $(body).a11y_focus();
                });
                this.$('.accordion-item-title-icon').removeClass('icon-minus').addClass('icon-plus');
                $('.accordion-item-title-icon', event.currentTarget).removeClass('icon-plus').addClass('icon-minus');

                if ($(event.currentTarget).hasClass('accordion-item')) {
                    this.setVisited($(event.currentTarget).index());
                } else {
                    this.setVisited($(event.currentTarget).parent('.accordion-item').index());
                }
            } else {
                this.$('.accordion-item-title').removeClass('selected');
                $(event.currentTarget).removeClass('selected');
                $('.accordion-item-title-icon', event.currentTarget).removeClass('icon-minus').addClass('icon-plus');
            }
            // set aria-expanded value
            if ($(event.currentTarget).hasClass('selected')) {
                $('.accordion-item-title').attr('aria-expanded', false);
                $(event.currentTarget).attr('aria-expanded', true);
            } else {
                $(event.currentTarget).attr('aria-expanded', false);
            }
        },

        setVisited: function(index) {
            var item = this.model.get('_items')[index];
            item._isVisited = true;
            this.checkCompletionStatus();
        },

        getVisitedItems: function() {
            return _.filter(this.model.get('_items'), function(item) {
                return item._isVisited;
            });
        },

        checkCompletionStatus: function() {
            if (!this.model.get('_isComplete')) {
                if (this.getVisitedItems().length == this.model.get('_items').length) {
                    this.setCompletionStatus();
                }
            }
        }

    });

    Adapt.register('accordion', Accordion);

    return Accordion;

});

define('components/adapt-contrib-assessmentResults/js/adapt-contrib-assessmentResults',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var AssessmentResults = ComponentView.extend({

        events: {
            'inview': 'onInview',
            'click .results-retry-button button': 'onRetry'
        },

        preRender: function () {
            if (this.model.setLocking) this.model.setLocking("_isVisible", false);

            this.setupEventListeners();
            this.setupModelResetEvent();
            this.checkIfComplete();
            this.checkIfVisible();
        },

        checkIfVisible: function() {

            var isVisibleBeforeCompletion = this.model.get("_isVisibleBeforeCompletion") || false;
            var isVisible = false;

            var wasVisible = this.model.get("_isVisible");

            if (!isVisibleBeforeCompletion) {

                var assessmentModel = Adapt.assessment.get(this.model.get("_assessmentId"));
                if (!assessmentModel || assessmentModel.length === 0) return;

                var state = assessmentModel.getState();
                var isComplete = state.isComplete;
                var isAttemptInProgress = state.attemptInProgress;
                var attemptsSpent = state.attemptsSpent;
                var hasHadAttempt = (!isAttemptInProgress && attemptsSpent > 0);
                
                isVisible = (isVisibleBeforeCompletion && !isComplete) || hasHadAttempt;

            }

            if (!wasVisible && isVisible) isVisible = false;

            this.model.set('_isVisible', isVisible, {pluginName: "assessmentResults"});
        },

        checkIfComplete: function() {
            var assessmentModel = Adapt.assessment.get(this.model.get("_assessmentId"));
            if (!assessmentModel || assessmentModel.length === 0) return;

            var state = assessmentModel.getState();
            var isComplete = state.isComplete;
            if (isComplete) {
                this.onAssessmentsComplete(state);
            } else {
                this.model.reset('hard', true);
            }
        },

        setupModelResetEvent: function() {
            if (this.model.onAssessmentsReset) return;
            this.model.onAssessmentsReset = function(state) {
                if (this.get("_assessmentId") === undefined || 
                    this.get("_assessmentId") != state.id) return;

                this.reset('hard', true);
            };
            this.model.listenTo(Adapt, 'assessments:reset', this.model.onAssessmentsReset);
        },

        postRender: function() {
            this.setReadyStatus();
        },

        setupEventListeners: function() {
            this.listenTo(Adapt, 'assessments:complete', this.onAssessmentsComplete);
            this.listenToOnce(Adapt, 'remove', this.onRemove);
        },

        removeEventListeners: function() {;
            this.stopListening(Adapt, 'assessments:complete', this.onAssessmentsComplete);
            this.stopListening(Adapt, 'remove', this.onRemove);
        },

        onAssessmentsComplete: function(state) {
            if (this.model.get("_assessmentId") === undefined || 
                this.model.get("_assessmentId") != state.id) return;

            this.model.set("_state", state);
            this.setFeedback();

            //show feedback component
            this.render();
            if(!this.model.get('_isVisible')) this.model.set('_isVisible', true, {pluginName: "assessmentResults"});
            
        },

        onAssessmentComplete: function(state) {
            this.model.set("_state", state);
            this.setFeedback();

             //show feedback component
            if(!this.model.get('_isVisible')) this.model.set('_isVisible', true, {pluginName: "assessmentResults"});
            this.render();
        },

        onInview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }
                
                if (this._isVisibleTop || this._isVisibleBottom) {
                    this.setCompletionStatus();
                    this.$el.off("inview");
                }
            }
        },

        onRetry: function() {
            var state = this.model.get("_state");
            var assessmentModel = Adapt.assessment.get(state.id);

            assessmentModel.reset();
        },

        setFeedback: function() {

            var completionBody = this.model.get("_completionBody");
            var feedbackBand = this.getFeedbackBand();

            var state = this.model.get("_state");
            state.feedbackBand = feedbackBand;
            state.feedback = feedbackBand.feedback;

            this.checkRetryEnabled();

            completionBody = this.stringReplace(completionBody, state);

            this.model.set("body", completionBody);

        },

        getFeedbackBand: function() {
            var state = this.model.get("_state");

            var bands = _.sortBy(this.model.get("_bands"), '_score');
            
            for (var i = (bands.length - 1); i >= 0; i--) {
                if (state.scoreAsPercent >= bands[i]._score) {
                    return bands[i];
                }
            }

            return "";
        },

        checkRetryEnabled: function() {
            var state = this.model.get("_state");

            var assessmentModel = Adapt.assessment.get(state.id);
            if (!assessmentModel.canResetInPage()) return false;

            var isRetryEnabled = state.feedbackBand._allowRetry !== false;
            var isAttemptsLeft = (state.attemptsLeft > 0 || state.attemptsLeft === "infinite");

            var showRetry = isRetryEnabled && isAttemptsLeft;
            this.model.set("_isRetryEnabled", showRetry);

            if (showRetry) {
                var retryFeedback =  this.model.get("_retry").feedback;
                retryFeedback = this.stringReplace(retryFeedback, state);
                this.model.set("retryFeedback", retryFeedback);
            } else {
                this.model.set("retryFeedback", "");
            }
        },

        stringReplace: function(string, context) {
            //use handlebars style escaping for string replacement
            //only supports unescaped {{{ attributeName }}} and html escaped {{ attributeName }}
            //will string replace recursively until no changes have occured

            var changed = true;
            while (changed) {
                changed = false;
                for (var k in context) {
                    var contextValue = context[k];

                    switch (typeof contextValue) {
                    case "object":
                        continue;
                    case "number":
                        contextValue = Math.floor(contextValue);
                        break;
                    }

                    var regExNoEscaping = new RegExp("((\\{\\{\\{){1}[\\ ]*"+k+"[\\ ]*(\\}\\}\\}){1})","g");
                    var regExEscaped = new RegExp("((\\{\\{){1}[\\ ]*"+k+"[\\ ]*(\\}\\}){1})","g");

                    var preString = string;

                    string = string.replace(regExNoEscaping, contextValue);
                    var escapedText = $("<p>").text(contextValue).html();
                    string = string.replace(regExEscaped, escapedText);

                    if (string != preString) changed = true;

                }
            }

            return string;
        },

        onRemove: function() {
            if (this.model.unsetLocking) this.model.unsetLocking("_isVisible");

            this.removeEventListeners();
        }
        
    });
    
    Adapt.register("assessmentResults", AssessmentResults);
    
});

define('components/adapt-contrib-blank/js/adapt-contrib-blank',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var Blank = ComponentView.extend({


        preRender: function() {
            this.$el.addClass("no-state");
            // Checks to see if the blank should be reset on revisit
            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.setReadyStatus();
            this.$('.component-inner').on('inview', _.bind(this.inview, this));
        },

        // Used to check if the blank should reset on revisit
        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$('.component-inner').off('inview');
                    this.setCompletionStatus();
                }

            }
        }

    });

    Adapt.register('blank', Blank);

    return Blank;

});

define('components/adapt-contrib-mcq/js/adapt-contrib-mcq',['require','coreViews/questionView','coreJS/adapt'],function(require) {
    var QuestionView = require('coreViews/questionView');
    var Adapt = require('coreJS/adapt');

    var Mcq = QuestionView.extend({

        events: {
            'focus .mcq-item input':'onItemFocus',
            'blur .mcq-item input':'onItemBlur',
            'change .mcq-item input':'onItemSelected',
            'keyup .mcq-item input':'onKeyPress'
        },

        resetQuestionOnRevisit: function() {
            this.setAllItemsEnabled(true);
            this.resetQuestion();
        },

        setupQuestion: function() {
            // if only one answer is selectable, we should display radio buttons not checkboxes
            this.model.set("_isRadio", (this.model.get("_selectable") == 1) );
            
            this.model.set('_selectedItems', []);

            this.setupQuestionItemIndexes();

            this.setupRandomisation();
            
            this.restoreUserAnswers();
        },

        setupQuestionItemIndexes: function() {
            var items = this.model.get("_items");
            for (var i = 0, l = items.length; i < l; i++) {
                if (items[i]._index === undefined) items[i]._index = i;
            }
        },

        setupRandomisation: function() {
            if (this.model.get('_isRandom') && this.model.get('_isEnabled')) {
                this.model.set("_items", _.shuffle(this.model.get("_items")));
            }
        },

        restoreUserAnswers: function() {
            if (!this.model.get("_isSubmitted")) return;

            var selectedItems = [];
            var items = this.model.get("_items");
            var userAnswer = this.model.get("_userAnswer");
            _.each(items, function(item, index) {
                item._isSelected = userAnswer[item._index];
                if (item._isSelected) {
                    selectedItems.push(item)
                }
            });

            this.model.set("_selectedItems", selectedItems);

            this.setQuestionAsSubmitted();
            this.markQuestion();
            this.setScore();
            this.showMarking();
            this.setupFeedback();
        },

        disableQuestion: function() {
            this.setAllItemsEnabled(false);
        },

        enableQuestion: function() {
            this.setAllItemsEnabled(true);
        },

        setAllItemsEnabled: function(isEnabled) {
            _.each(this.model.get('_items'), function(item, index){
                var $itemLabel = this.$('label').eq(index);
                var $itemInput = this.$('input').eq(index);

                if (isEnabled) {
                    $itemLabel.removeClass('disabled');
                    $itemInput.prop('disabled', false);
                } else {
                    $itemLabel.addClass('disabled');
                    $itemInput.prop('disabled', true);
                }
            }, this);
        },

        onQuestionRendered: function() {
            this.setReadyStatus();
        },

        onKeyPress: function(event) {
            if (event.which === 13) { //<ENTER> keypress
                this.onItemSelected(event);
            }
        },

        onItemFocus: function(event) {
            if(this.model.get('_isEnabled') && !this.model.get('_isSubmitted')){
                $("label[for='"+$(event.currentTarget).attr('id')+"']").addClass('highlighted');
            }
        },
        
        onItemBlur: function(event) {
            $("label[for='"+$(event.currentTarget).attr('id')+"']").removeClass('highlighted');
        },

        onItemSelected: function(event) {
            if(this.model.get('_isEnabled') && !this.model.get('_isSubmitted')){
                var selectedItemObject = this.model.get('_items')[$(event.currentTarget).parent('.component-item').index()];
                this.toggleItemSelected(selectedItemObject, event);
            }
        },

        toggleItemSelected:function(item, clickEvent) {
            var selectedItems = this.model.get('_selectedItems');
            var itemIndex = _.indexOf(this.model.get('_items'), item),
                $itemLabel = this.$('label').eq(itemIndex),
                $itemInput = this.$('input').eq(itemIndex),
                selected = !$itemLabel.hasClass('selected');
            
                if(selected) {
                    if(this.model.get('_selectable') === 1){
                        this.$('label').removeClass('selected');
                        this.$('input').prop('checked', false);
                        this.deselectAllItems();
                        selectedItems[0] = item;
                    } else if(selectedItems.length < this.model.get('_selectable')) {
                     selectedItems.push(item);
                 } else {
                    clickEvent.preventDefault();
                    return;
                }
                $itemLabel.addClass('selected');
                $itemLabel.a11y_selected(true);
            } else {
                selectedItems.splice(_.indexOf(selectedItems, item), 1);
                $itemLabel.removeClass('selected');
                $itemLabel.a11y_selected(false);
            }
            $itemInput.prop('checked', selected);
            item._isSelected = selected;
            this.model.set('_selectedItems', selectedItems);
        },

        // check if the user is allowed to submit the question
        canSubmit: function() {
            var count = 0;

            _.each(this.model.get('_items'), function(item) {
                if (item._isSelected) {
                    count++;
                }
            }, this);

            return (count > 0) ? true : false;

        },

        // Blank method to add functionality for when the user cannot submit
        // Could be used for a popup or explanation dialog/hint
        onCannotSubmit: function() {},

        // This is important for returning or showing the users answer
        // This should preserve the state of the users answers
        storeUserAnswer: function() {
            var userAnswer = [];

            var items = this.model.get('_items').slice(0);
            items.sort(function(a, b) {
                return a._index - b._index;
            });

            _.each(items, function(item, index) {
                userAnswer.push(item._isSelected);
            }, this);
            this.model.set('_userAnswer', userAnswer);
        },

        isCorrect: function() {

            var numberOfRequiredAnswers = 0;
            var numberOfCorrectAnswers = 0;
            var numberOfIncorrectAnswers = 0;

            _.each(this.model.get('_items'), function(item, index) {

                var itemSelected = (item._isSelected || false);

                if (item._shouldBeSelected) {
                    numberOfRequiredAnswers ++;

                    if (itemSelected) {
                        numberOfCorrectAnswers ++;
                        
                        item._isCorrect = true;

                        this.model.set('_isAtLeastOneCorrectSelection', true);
                    }

                } else if (!item._shouldBeSelected && itemSelected) {
                    numberOfIncorrectAnswers ++;
                }

            }, this);

            this.model.set('_numberOfCorrectAnswers', numberOfCorrectAnswers);
            this.model.set('_numberOfRequiredAnswers', numberOfRequiredAnswers);

            // Check if correct answers matches correct items and there are no incorrect selections
            var answeredCorrectly = (numberOfCorrectAnswers === numberOfRequiredAnswers) && (numberOfIncorrectAnswers === 0);
            return answeredCorrectly;
        },

        // Sets the score based upon the questionWeight
        // Can be overwritten if the question needs to set the score in a different way
        setScore: function() {
            var questionWeight = this.model.get("_questionWeight");
            var answeredCorrectly = this.model.get('_isCorrect');
            var score = answeredCorrectly ? questionWeight : 0;
            this.model.set('_score', score);
        },

        setupFeedback: function() {

            if (this.model.get('_isCorrect')) {
                this.setupCorrectFeedback();
            } else if (this.isPartlyCorrect()) {
                this.setupPartlyCorrectFeedback();
            } else {
                // apply individual item feedback
                if((this.model.get('_selectable') === 1) && this.model.get('_selectedItems')[0].feedback) {
                    this.setupIndividualFeedback(this.model.get('_selectedItems')[0]);
                    return;
                } else {
                    this.setupIncorrectFeedback();
                }
            }
        },

        setupIndividualFeedback: function(selectedItem) {
             this.model.set({
                 feedbackTitle: this.model.get('title'),
                 feedbackMessage: selectedItem.feedback
             });
        },

        // This is important and should give the user feedback on how they answered the question
        // Normally done through ticks and crosses by adding classes
        showMarking: function() {
            _.each(this.model.get('_items'), function(item, i) {
                var $item = this.$('.component-item').eq(i);
                $item.removeClass('correct incorrect').addClass(item._isCorrect ? 'correct' : 'incorrect');
            }, this);
        },

        isPartlyCorrect: function() {
            return this.model.get('_isAtLeastOneCorrectSelection');
        },

        resetUserAnswer: function() {
            this.model.set({_userAnswer: []});
        },

        // Used by the question view to reset the look and feel of the component.
        resetQuestion: function() {

            this.deselectAllItems();
            this.resetItems();
        },

        deselectAllItems: function() {
            this.$el.a11y_selected(false);
            _.each(this.model.get('_items'), function(item) {
                item._isSelected = false;
            }, this);
        },

        resetItems: function() {
            this.$('.component-item label').removeClass('selected');
            this.$('.component-item').removeClass('correct incorrect');
            this.$('input').prop('checked', false);
            this.model.set({
                _selectedItems: [],
                _isAtLeastOneCorrectSelection: false
            });
        },

        showCorrectAnswer: function() {
            _.each(this.model.get('_items'), function(item, index) {
                this.setOptionSelected(index, item._shouldBeSelected);
            }, this);
        },

        setOptionSelected:function(index, selected) {
            var $itemLabel = this.$('label').eq(index);
            var $itemInput = this.$('input').eq(index);
            if (selected) {
                $itemLabel.addClass('selected');
                $itemInput.prop('checked', true);
            } else {
                $itemLabel.removeClass('selected');
                $itemInput.prop('checked', false);
            }
        },

        hideCorrectAnswer: function() {
            _.each(this.model.get('_items'), function(item, index) {
                this.setOptionSelected(index, this.model.get('_userAnswer')[item._index]);
            }, this);
        },

        /**
        * used by adapt-contrib-spoor to get the user's answers in the format required by the cmi.interactions.n.student_response data field
        * returns the user's answers as a string in the format "1,5,2"
        */
        getResponse:function() {
            var selected = _.where(this.model.get('_items'), {'_isSelected':true});
            var selectedIndexes = _.pluck(selected, '_index');
            // indexes are 0-based, we need them to be 1-based for cmi.interactions
            for (var i = 0, count = selectedIndexes.length; i < count; i++) {
                selectedIndexes[i]++;
            }
            return selectedIndexes.join(',');
        },

        /**
        * used by adapt-contrib-spoor to get the type of this question in the format required by the cmi.interactions.n.type data field
        */
        getResponseType:function() {
            return "choice";
        }

    });

    Adapt.register("mcq", Mcq);

    return Mcq;
});

define('components/adapt-contrib-gmcq/js/adapt-contrib-gmcq',['require','components/adapt-contrib-mcq/js/adapt-contrib-mcq','coreJS/adapt'],function(require) {
    var Mcq = require('components/adapt-contrib-mcq/js/adapt-contrib-mcq');
    var Adapt = require('coreJS/adapt');

    var Gmcq = Mcq.extend({

        events: function() {

            var events = {
                'focus .gmcq-item input': 'onItemFocus',
                'blur .gmcq-item input': 'onItemBlur',
                'change .gmcq-item input': 'onItemSelected',
                'keyup .gmcq-item input':'onKeyPress'
            };

            if ($('html').hasClass('ie8')) {

                var ie8Events = {
                    'click label img': 'forceChangeEvent'
                };

                events = _.extend(events, ie8Events);
            }

            return events;

        },

        onItemSelected: function(event) {

            var selectedItemObject = this.model.get('_items')[$(event.currentTarget).parent('.gmcq-item').index()];

            if (this.model.get('_isEnabled') && !this.model.get('_isSubmitted')) {
                this.toggleItemSelected(selectedItemObject, event);
            }

        },

        setupQuestion: function() {
            // if only one answer is selectable, we should display radio buttons not checkboxes
            this.model.set("_isRadio", (this.model.get("_selectable") == 1) );

            this.model.set('_selectedItems', []);

            this.setupQuestionItemIndexes();

            this.setupRandomisation();

            this.restoreUserAnswers();

            this.listenTo(Adapt, 'device:changed', this.resizeImage);

        },

        onQuestionRendered: function() {

            this.resizeImage(Adapt.device.screenSize);

            this.$('label').imageready(_.bind(function() {
                this.setReadyStatus();
            }, this));

        },

        resizeImage: function(width) {

            var imageWidth = width === 'medium' ? 'small' : width;

            this.$('label').each(function(index) {
                var src = $(this).find('img').attr('data-' + imageWidth);
                $(this).find('img').attr('src', src);
            });

        },

        // hack for IE8
        forceChangeEvent: function(event) {

            $("#" + $(event.currentTarget).closest("label").attr("for")).change();

        }

    }, {
        template: 'gmcq'
    });

    Adapt.register("gmcq", Gmcq);

    return Gmcq;

});

define('components/adapt-contrib-graphic/js/adapt-contrib-graphic',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var Graphic = ComponentView.extend({

        preRender: function() {
            this.listenTo(Adapt, 'device:changed', this.resizeImage);

            // Checks to see if the graphic should be reset on revisit
            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.resizeImage(Adapt.device.screenSize);
            this.$('.component-widget').on('inview', _.bind(this.inview, this));
        },

        // Used to check if the graphic should reset on revisit
        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$('.component-widget').off('inview');
                    this.setCompletionStatus();
                }

            }
        },

        resizeImage: function(width) {
            var imageWidth = width === 'medium' ? 'small' : width;
            this.$('.graphic-widget img').attr('src', this.model.get('_graphic')[imageWidth]);

            this.$('.graphic-widget').imageready(_.bind(function() {
                this.setReadyStatus();
            }, this));
        }
    });

    Adapt.register('graphic', Graphic);

    return Graphic;

});

define('components/adapt-contrib-hotgraphic/js/adapt-contrib-hotgraphic',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var HotGraphic = ComponentView.extend({

        initialize: function() {
            this.listenTo(Adapt, 'remove', this.remove);
            this.listenTo(this.model, 'change:_isVisible', this.toggleVisibility);
            this.model.set('_globals', Adapt.course.get('_globals'));
            this.preRender();
            if (this.model.get('_canCycleThroughPagination') === undefined) {
                this.model.set('_canCycleThroughPagination', false);
            }
            if (Adapt.device.screenSize == 'large') {
                this.render();
            } else {
                this.reRender();
            }
        },

        events: function() {
            return {
                'click .hotgraphic-graphic-pin': 'openHotGraphic',
                'click .hotgraphic-popup-done': 'closeHotGraphic',
                'click .hotgraphic-popup-nav .back': 'previousHotGraphic',
                'click .hotgraphic-popup-nav .next': 'nextHotGraphic'
            }
        },

        preRender: function() {
            this.listenTo(Adapt, 'device:changed', this.reRender, this);

            // Checks to see if the hotgraphic should be reset on revisit
            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.renderState();
            this.$('.hotgraphic-widget').imageready(_.bind(function() {
                this.setReadyStatus();
            }, this));

            this.setupEventListeners();
        },

        // Used to check if the hotgraphic should reset on revisit
        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);

                _.each(this.model.get('_items'), function(item) {
                    item._isVisited = false;
                });
            }
        },

        reRender: function() {
            if (Adapt.device.screenSize != 'large') {
                this.replaceWithNarrative();
            }
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$('.component-inner').off('inview');
                    this.setCompletionStatus();
                }
            }
        },

        replaceWithNarrative: function() {
            if (!Adapt.componentStore.narrative) throw "Narrative not included in build";
            var Narrative = Adapt.componentStore.narrative;

            var model = this.prepareNarrativeModel();
            var newNarrative = new Narrative({ model: model });
            var $container = $(".component-container", $("." + this.model.get("_parentId")));

            newNarrative.reRender();
            newNarrative.setupNarrative();
            $container.append(newNarrative.$el);
            Adapt.trigger('device:resize');
            _.defer(_.bind(function () {
                this.remove();
            }, this));
        },

        prepareNarrativeModel: function() {
            var model = this.model;
            model.set('_component', 'narrative');
            model.set('_wasHotgraphic', true);
            model.set('originalBody', model.get('body'));
            model.set('originalInstruction', model.get('instruction'));
            if (model.get('mobileBody')) {
                model.set('body', model.get('mobileBody'));
            }
            if (model.get('mobileInstruction')) {
                model.set('instruction', model.get('mobileInstruction'));
            }

            return model;
        },

        applyNavigationClasses: function (index) {
            var $nav = this.$('.hotgraphic-popup-nav'),
                itemCount = this.$('.hotgraphic-item').length;

            $nav.removeClass('first').removeClass('last');
            this.$('.hotgraphic-popup-done').a11y_cntrl_enabled(true);
            if(index <= 0 && !this.model.get('_canCycleThroughPagination')) {
                this.$('.hotgraphic-popup-nav').addClass('first');
                this.$('.hotgraphic-popup-controls.back').a11y_cntrl_enabled(false);
                this.$('.hotgraphic-popup-controls.next').a11y_cntrl_enabled(true);
            } else if (index >= itemCount-1 && !this.model.get('_canCycleThroughPagination')) {
                this.$('.hotgraphic-popup-nav').addClass('last');
                this.$('.hotgraphic-popup-controls.back').a11y_cntrl_enabled(true);
                this.$('.hotgraphic-popup-controls.next').a11y_cntrl_enabled(false);
            } else {
                this.$('.hotgraphic-popup-controls.back').a11y_cntrl_enabled(true);
                this.$('.hotgraphic-popup-controls.next').a11y_cntrl_enabled(true);
            }
            var classes = this.model.get("_items")[index]._classes 
                ? this.model.get("_items")[index]._classes
                : '';  // _classes has not been defined
      
            this.$('.hotgraphic-popup').attr('class', 'hotgraphic-popup ' + 'item-' + index + ' ' + classes);

        },

        openHotGraphic: function (event) {
            event.preventDefault();
            this.$('.hotgraphic-popup-inner').a11y_on(false);
            var currentHotSpot = $(event.currentTarget).data('id');
            this.$('.hotgraphic-item').hide().removeClass('active');
            this.$('.'+currentHotSpot).show().addClass('active');
            var currentIndex = this.$('.hotgraphic-item.active').index();
            this.setVisited(currentIndex);
            this.$('.hotgraphic-popup-count .current').html(currentIndex+1);
            this.$('.hotgraphic-popup-count .total').html(this.$('.hotgraphic-item').length);
            this.$('.hotgraphic-popup').attr('class', 'hotgraphic-popup ' + 'item-' + currentIndex);
            this.$('.hotgraphic-popup').show();
            this.$('.hotgraphic-popup-inner .active').a11y_on(true);
              
            Adapt.trigger('popup:opened',  this.$('.hotgraphic-popup-inner'));

            this.$('.hotgraphic-popup-inner .active').a11y_focus();
            this.applyNavigationClasses(currentIndex);
        },

        closeHotGraphic: function(event) {
            event.preventDefault();
            var currentIndex = this.$('.hotgraphic-item.active').index();
            this.$('.hotgraphic-popup').hide();
            Adapt.trigger('popup:closed',  this.$('.hotgraphic-popup-inner'));
        },

        previousHotGraphic: function (event) {
            event.preventDefault();
            var currentIndex = this.$('.hotgraphic-item.active').index();

            if (currentIndex === 0 && !this.model.get('_canCycleThroughPagination')) {
                return;
            } else if (currentIndex === 0 && this.model.get('_canCycleThroughPagination')) {
                currentIndex = this.model.get('_items').length;
            }

            this.$('.hotgraphic-item.active').hide().removeClass('active');
            this.$('.hotgraphic-item').eq(currentIndex-1).show().addClass('active');
            this.setVisited(currentIndex-1);
            this.$('.hotgraphic-popup-count .current').html(currentIndex);
            this.$('.hotgraphic-popup-inner').a11y_on(false);

            this.applyNavigationClasses(currentIndex-1);
            this.$('.hotgraphic-popup-inner .active').a11y_on(true);
            this.$('.hotgraphic-popup-inner .active').a11y_focus();
        },

        nextHotGraphic: function (event) {
            event.preventDefault();
            var currentIndex = this.$('.hotgraphic-item.active').index();
            if (currentIndex === (this.model.get('_items').length-1) && !this.model.get('_canCycleThroughPagination')) {
                return;
            } else if (currentIndex === (this.model.get('_items').length-1) && this.model.get('_canCycleThroughPagination')) {
                currentIndex = -1;
            }
            this.$('.hotgraphic-item.active').hide().removeClass('active');
            this.$('.hotgraphic-item').eq(currentIndex+1).show().addClass('active');
            this.setVisited(currentIndex+1);
            this.$('.hotgraphic-popup-count .current').html(currentIndex+2);
            this.$('.hotgraphic-popup-inner').a11y_on(false);

            this.applyNavigationClasses(currentIndex+1);
            this.$('.hotgraphic-popup-inner .active').a11y_on(true);
            this.$('.hotgraphic-popup-inner .active').a11y_focus();
        },

        setVisited: function(index) {
            var item = this.model.get('_items')[index];
            item._isVisited = true;

            var $pin = this.$('.hotgraphic-graphic-pin').eq(index);
            $pin.addClass('visited');
            // append the word 'visited.' to the pin's aria-label
            var visitedLabel = this.model.get('_globals')._accessibility._ariaLabels.visited + ".";
            $pin.attr('aria-label', function(index, val) {return val + " " + visitedLabel});

            $.a11y_alert("visited");

            this.checkCompletionStatus();
        },

        getVisitedItems: function() {
            return _.filter(this.model.get('_items'), function(item) {
                return item._isVisited;
            });
        },

        checkCompletionStatus: function() {
            if (!this.model.get('_isComplete')) {
                if (this.getVisitedItems().length == this.model.get('_items').length) {
                    this.trigger('allItems');
                }
            }
        },

        onCompletion: function() {
            this.setCompletionStatus();
            if (this.completionEvent && this.completionEvent != 'inview') {
                this.off(this.completionEvent, this);
            }
        },

        setupEventListeners: function() {
            this.completionEvent = (!this.model.get('_setCompletionOn')) ? 'allItems' : this.model.get('_setCompletionOn');
            if (this.completionEvent !== 'inview') {
                this.on(this.completionEvent, _.bind(this.onCompletion, this));
            } else {
                this.$('.component-widget').on('inview', _.bind(this.inview, this));
            }
        }

    });

    Adapt.register('hotgraphic', HotGraphic);

    return HotGraphic;

});

define('components/adapt-contrib-matching/js/adapt-contrib-matching',['require','coreViews/questionView','coreJS/adapt'],function(require) {

    var QuestionView = require('coreViews/questionView');
    var Adapt = require('coreJS/adapt');

    var Matching = QuestionView.extend({

        // Used by questionView to disable the question during submit and complete stages
        disableQuestion: function() {
            this.$('.matching-select').prop('disabled', true);
        },

        // Used by questionView to enable the question during interactions
        enableQuestion: function() {
            this.$('.matching-select').prop('disabled', false);
        },

        // Used by questionView to reset the question when revisiting the component
        resetQuestionOnRevisit: function() {
            this.resetQuestion();
        },

        setupQuestion: function() {
            this.setupItemIndexes();
            
            this.restoreUserAnswers();

            this.setupRandomisation();
        },

        setupItemIndexes: function() {

            _.each(this.model.get("_items"), function(item, index) {
                if (item._index == undefined) {
                    item._index = index;
                    item._selected = false;
                }
                _.each(item._options, function(option, index) {
                    if (option._index == undefined) {
                        option._index = index;
                        option._isSelected = false;
                    }
                });
            });

        },

        restoreUserAnswers: function() {
            if (!this.model.get("_isSubmitted")) return;

            var userAnswer = this.model.get("_userAnswer");

            _.each(this.model.get("_items"), function(item, index) {
                _.each(item._options, function(option, index) {
                    if (option._index == userAnswer[item._index]) {
                        option._isSelected = true;
                        item._selected = option;
                    }
                });
            });

            this.setQuestionAsSubmitted();
            this.markQuestion();
            this.setScore();
            this.showMarking();
            this.setupFeedback();
        },

        setupRandomisation: function() {
            if (this.model.get('_isRandom') && this.model.get('_isEnabled')) {
                _.each(this.model.get('_items'), function(item) {
                    item._options = _.shuffle(item._options);
                });
            }
        },

        onQuestionRendered: function() {
            this.setReadyStatus();
        },

        canSubmit: function() {

            var canSubmit = true;

            $('.matching-select option:selected', this.el).each(_.bind(function(index, element) {

                var $element = $(element);

                if ($element.index() == 0) {
                    canSubmit = false;
                    $element.parent('.matching-select').addClass('error');
                }
            }, this));

            return canSubmit;
        },

        // Blank method for question to fill out when the question cannot be submitted
        onCannotSubmit: function() {
            //TODO have this highlight all the drop-downs the user has yet to select.
            //Currently it just highlights the first one, even if that one has been selected
        },

        storeUserAnswer: function() {

            var userAnswer = new Array(this.model.get('_items').length);
            var tempUserAnswer = new Array(this.model.get('_items').length);

            _.each(this.model.get('_items'), function(item, index) {

                var $selectedOption = this.$('.matching-select option:selected').eq(index);
                var optionIndex = $selectedOption.index() - 1;

                item._options[optionIndex]._isSelected = true;
                item._selected = item._options[optionIndex];

                tempUserAnswer[item._index] = optionIndex;
                userAnswer[item._index] = item._options[optionIndex]._index;
            }, this);

            this.model.set('_userAnswer', userAnswer);
            this.model.set('_tempUserAnswer', tempUserAnswer);
        },

        isCorrect: function() {

            var numberOfCorrectAnswers = 0;

            _.each(this.model.get('_items'), function(item, index) {

                if (item._selected && item._selected._isCorrect) {
                    numberOfCorrectAnswers++;
                    item._isCorrect = true;
                    this.model.set('_numberOfCorrectAnswers', numberOfCorrectAnswers);
                    this.model.set('_isAtLeastOneCorrectSelection', true);
                } else {
                    item._isCorrect = false;
                }

            }, this);

            this.model.set('_numberOfCorrectAnswers', numberOfCorrectAnswers);

            if (numberOfCorrectAnswers === this.model.get('_items').length) {
                return true;
            } else {
                return false;
            }

        },

        setScore: function() {
            var questionWeight = this.model.get("_questionWeight");

            if (this.model.get('_isCorrect')) {
                this.model.set('_score', questionWeight);
                return;
            }

            var numberOfCorrectAnswers = this.model.get('_numberOfCorrectAnswers');
            var itemLength = this.model.get('_items').length;

            var score = questionWeight * numberOfCorrectAnswers / itemLength;

            this.model.set('_score', score);
        },

        // This is important and should give the user feedback on how they answered the question
        // Normally done through ticks and crosses by adding classes
        showMarking: function() {

            _.each(this.model.get('_items'), function(item, i) {

                var $item = this.$('.matching-item').eq(i);
                $item.removeClass('correct incorrect').addClass(item._isCorrect ? 'correct' : 'incorrect');
            }, this);
        },

        // Used by the question to determine if the question is incorrect or partly correct
        // Should return a boolean
        isPartlyCorrect: function() {
            return this.model.get('_isAtLeastOneCorrectSelection');
        },

        resetUserAnswer: function() {
            this.model.set({_userAnswer: []});
        },

        // Used by the question view to reset the look and feel of the component.
        resetQuestion: function() {

            this.$('.matching-select option').prop('selected', false);
            
            this.$(".matching-item").removeClass("correct").removeClass("incorrect");
            
            this.model.set('_isAtLeastOneCorrectSelection', false);
            
            _.each(this.$('.matching-select'), function(item) {
                this.selectOption($(item), 0);
            }, this);
            
            _.each(this.model.get("_items"), function(item, index) {
                _.each(item._options, function(option, index) {
                    option._isSelected = false;
                });
            });
        },

        showCorrectAnswer: function() {

            _.each(this.model.get('_items'), function(item, index) {

                var correctOptionIndex;

                _.each(item._options, function(option, optionIndex) {
                    if (option._isCorrect) {
                        correctOptionIndex = optionIndex + 1;
                    }
                }, this);

                var $parent = this.$('.matching-select').eq(index);

                this.selectOption($parent, correctOptionIndex);
            }, this);
        },

        hideCorrectAnswer: function() {

            for (var i = 0, count = this.model.get('_items').length; i < count; i++) {
                var $parent = this.$('.matching-select').eq(i);

                var index = this.model.has('_tempUserAnswer')
                  ? this.model.get('_tempUserAnswer')[i] + 1
                  : this.model.get('_userAnswer')[i] + 1;

                $('option', $parent).eq(index).prop('selected', true);

                this.selectOption($parent, index);
            }
        },

        selectOption: function($parent, optionIndex) {
            $("option", $parent).eq(optionIndex).prop('selected', true);
        },

        /**
        * Used by adapt-contrib-spoor to get the user's answers in the format required by the cmi.interactions.n.student_response data field
        * Returns the user's answers as a string in the format "1.1#2.3#3.2" assuming user selected option 1 in drop-down 1, option 3 in drop-down 2
        * and option 2 in drop-down 3. The '#' character will be changed to either ',' or '[,]' by adapt-contrib-spoor, depending on which SCORM version is being used.
        */
        getResponse: function() {

            var userAnswer = this.model.get('_userAnswer');
            var responses = [];

            for(var i = 0, count = userAnswer.length; i < count; i++) {
                responses.push((i + 1) + "." + (userAnswer[i] + 1));// convert from 0-based to 1-based counting
            }
            
            return responses.join('#');
        },

        /**
        * Used by adapt-contrib-spoor to get the type of this question in the format required by the cmi.interactions.n.type data field
        */
        getResponseType: function() {
            return "matching";
        }

    });

    Adapt.register("matching", Matching);

    return Matching;

});

/*!
 *
 * MediaElement.js
 * HTML5 <video> and <audio> shim and player
 * http://mediaelementjs.com/
 *
 * Creates a JavaScript object that mimics HTML5 MediaElement API
 * for browsers that don't understand HTML5 or can't play the provided codec
 * Can play MP4 (H.264), Ogg, WebM, FLV, WMV, WMA, ACC, and MP3
 *
 * Copyright 2010-2014, John Dyer (http://j.hn)
 * License: MIT
 *
 */
var mejs=mejs||{};mejs.version="2.18.1",mejs.meIndex=0,mejs.plugins={silverlight:[{version:[3,0],types:["video/mp4","video/m4v","video/mov","video/wmv","audio/wma","audio/m4a","audio/mp3","audio/wav","audio/mpeg"]}],flash:[{version:[9,0,124],types:["video/mp4","video/m4v","video/mov","video/flv","video/rtmp","video/x-flv","audio/flv","audio/x-flv","audio/mp3","audio/m4a","audio/mpeg","video/youtube","video/x-youtube","video/dailymotion","video/x-dailymotion","application/x-mpegURL"]}],youtube:[{version:null,types:["video/youtube","video/x-youtube","audio/youtube","audio/x-youtube"]}],vimeo:[{version:null,types:["video/vimeo","video/x-vimeo"]}]},mejs.Utility={encodeUrl:function(a){return encodeURIComponent(a)},escapeHTML:function(a){return a.toString().split("&").join("&amp;").split("<").join("&lt;").split('"').join("&quot;")},absolutizeUrl:function(a){var b=document.createElement("div");return b.innerHTML='<a href="'+this.escapeHTML(a)+'">x</a>',b.firstChild.href},getScriptPath:function(a){for(var b,c,d,e,f,g,h=0,i="",j="",k=document.getElementsByTagName("script"),l=k.length,m=a.length;l>h;h++){for(e=k[h].src,c=e.lastIndexOf("/"),c>-1?(g=e.substring(c+1),f=e.substring(0,c+1)):(g=e,f=""),b=0;m>b;b++)if(j=a[b],d=g.indexOf(j),d>-1){i=f;break}if(""!==i)break}return i},calculateTimeFormat:function(a,b,c){0>a&&(a=0),"undefined"==typeof c&&(c=25);var d=b.timeFormat,e=d[0],f=d[1]==d[0],g=f?2:1,h=":",i=Math.floor(a/3600)%24,j=Math.floor(a/60)%60,k=Math.floor(a%60),l=Math.floor((a%1*c).toFixed(3)),m=[[l,"f"],[k,"s"],[j,"m"],[i,"h"]];d.length<g&&(h=d[g]);for(var n=!1,o=0,p=m.length;p>o;o++)if(-1!==d.indexOf(m[o][1]))n=!0;else if(n){for(var q=!1,r=o;p>r;r++)if(m[r][0]>0){q=!0;break}if(!q)break;f||(d=e+d),d=m[o][1]+h+d,f&&(d=m[o][1]+d),e=m[o][1]}b.currentTimeFormat=d},twoDigitsString:function(a){return 10>a?"0"+a:String(a)},secondsToTimeCode:function(a,b){0>a&&(a=0);var c=b.framesPerSecond;"undefined"==typeof c&&(c=25);var d=b.currentTimeFormat,e=Math.floor(a/3600)%24,f=Math.floor(a/60)%60,g=Math.floor(a%60),h=Math.floor((a%1*c).toFixed(3));lis=[[h,"f"],[g,"s"],[f,"m"],[e,"h"]];var j=d;for(i=0,len=lis.length;i<len;i++)j=j.replace(lis[i][1]+lis[i][1],this.twoDigitsString(lis[i][0])),j=j.replace(lis[i][1],lis[i][0]);return j},timeCodeToSeconds:function(a,b,c,d){"undefined"==typeof c?c=!1:"undefined"==typeof d&&(d=25);var e=a.split(":"),f=parseInt(e[0],10),g=parseInt(e[1],10),h=parseInt(e[2],10),i=0,j=0;return c&&(i=parseInt(e[3])/d),j=3600*f+60*g+h+i},convertSMPTEtoSeconds:function(a){if("string"!=typeof a)return!1;a=a.replace(",",".");var b=0,c=-1!=a.indexOf(".")?a.split(".")[1].length:0,d=1;a=a.split(":").reverse();for(var e=0;e<a.length;e++)d=1,e>0&&(d=Math.pow(60,e)),b+=Number(a[e])*d;return Number(b.toFixed(c))},removeSwf:function(a){var b=document.getElementById(a);b&&/object|embed/i.test(b.nodeName)&&(mejs.MediaFeatures.isIE?(b.style.display="none",function(){4==b.readyState?mejs.Utility.removeObjectInIE(a):setTimeout(arguments.callee,10)}()):b.parentNode.removeChild(b))},removeObjectInIE:function(a){var b=document.getElementById(a);if(b){for(var c in b)"function"==typeof b[c]&&(b[c]=null);b.parentNode.removeChild(b)}}},mejs.PluginDetector={hasPluginVersion:function(a,b){var c=this.plugins[a];return b[1]=b[1]||0,b[2]=b[2]||0,c[0]>b[0]||c[0]==b[0]&&c[1]>b[1]||c[0]==b[0]&&c[1]==b[1]&&c[2]>=b[2]?!0:!1},nav:window.navigator,ua:window.navigator.userAgent.toLowerCase(),plugins:[],addPlugin:function(a,b,c,d,e){this.plugins[a]=this.detectPlugin(b,c,d,e)},detectPlugin:function(a,b,c,d){var e,f,g,h=[0,0,0];if("undefined"!=typeof this.nav.plugins&&"object"==typeof this.nav.plugins[a]){if(e=this.nav.plugins[a].description,e&&("undefined"==typeof this.nav.mimeTypes||!this.nav.mimeTypes[b]||this.nav.mimeTypes[b].enabledPlugin))for(h=e.replace(a,"").replace(/^\s+/,"").replace(/\sr/gi,".").split("."),f=0;f<h.length;f++)h[f]=parseInt(h[f].match(/\d+/),10)}else if("undefined"!=typeof window.ActiveXObject)try{g=new ActiveXObject(c),g&&(h=d(g))}catch(i){}return h}},mejs.PluginDetector.addPlugin("flash","Shockwave Flash","application/x-shockwave-flash","ShockwaveFlash.ShockwaveFlash",function(a){var b=[],c=a.GetVariable("$version");return c&&(c=c.split(" ")[1].split(","),b=[parseInt(c[0],10),parseInt(c[1],10),parseInt(c[2],10)]),b}),mejs.PluginDetector.addPlugin("silverlight","Silverlight Plug-In","application/x-silverlight-2","AgControl.AgControl",function(a){var b=[0,0,0,0],c=function(a,b,c,d){for(;a.isVersionSupported(b[0]+"."+b[1]+"."+b[2]+"."+b[3]);)b[c]+=d;b[c]-=d};return c(a,b,0,1),c(a,b,1,1),c(a,b,2,1e4),c(a,b,2,1e3),c(a,b,2,100),c(a,b,2,10),c(a,b,2,1),c(a,b,3,1),b}),mejs.MediaFeatures={init:function(){var a,b,c=this,d=document,e=mejs.PluginDetector.nav,f=mejs.PluginDetector.ua.toLowerCase(),g=["source","track","audio","video"];c.isiPad=null!==f.match(/ipad/i),c.isiPhone=null!==f.match(/iphone/i),c.isiOS=c.isiPhone||c.isiPad,c.isAndroid=null!==f.match(/android/i),c.isBustedAndroid=null!==f.match(/android 2\.[12]/),c.isBustedNativeHTTPS="https:"===location.protocol&&(null!==f.match(/android [12]\./)||null!==f.match(/macintosh.* version.* safari/)),c.isIE=-1!=e.appName.toLowerCase().indexOf("microsoft")||null!==e.appName.toLowerCase().match(/trident/gi),c.isChrome=null!==f.match(/chrome/gi),c.isChromium=null!==f.match(/chromium/gi),c.isFirefox=null!==f.match(/firefox/gi),c.isWebkit=null!==f.match(/webkit/gi),c.isGecko=null!==f.match(/gecko/gi)&&!c.isWebkit&&!c.isIE,c.isOpera=null!==f.match(/opera/gi),c.hasTouch="ontouchstart"in window,c.svg=!!document.createElementNS&&!!document.createElementNS("http://www.w3.org/2000/svg","svg").createSVGRect;for(a=0;a<g.length;a++)b=document.createElement(g[a]);c.supportsMediaTag="undefined"!=typeof b.canPlayType||c.isBustedAndroid;try{b.canPlayType("video/mp4")}catch(h){c.supportsMediaTag=!1}c.hasSemiNativeFullScreen="undefined"!=typeof b.webkitEnterFullscreen,c.hasNativeFullscreen="undefined"!=typeof b.requestFullscreen,c.hasWebkitNativeFullScreen="undefined"!=typeof b.webkitRequestFullScreen,c.hasMozNativeFullScreen="undefined"!=typeof b.mozRequestFullScreen,c.hasMsNativeFullScreen="undefined"!=typeof b.msRequestFullscreen,c.hasTrueNativeFullScreen=c.hasWebkitNativeFullScreen||c.hasMozNativeFullScreen||c.hasMsNativeFullScreen,c.nativeFullScreenEnabled=c.hasTrueNativeFullScreen,c.hasMozNativeFullScreen?c.nativeFullScreenEnabled=document.mozFullScreenEnabled:c.hasMsNativeFullScreen&&(c.nativeFullScreenEnabled=document.msFullscreenEnabled),c.isChrome&&(c.hasSemiNativeFullScreen=!1),c.hasTrueNativeFullScreen&&(c.fullScreenEventName="",c.hasWebkitNativeFullScreen?c.fullScreenEventName="webkitfullscreenchange":c.hasMozNativeFullScreen?c.fullScreenEventName="mozfullscreenchange":c.hasMsNativeFullScreen&&(c.fullScreenEventName="MSFullscreenChange"),c.isFullScreen=function(){return c.hasMozNativeFullScreen?d.mozFullScreen:c.hasWebkitNativeFullScreen?d.webkitIsFullScreen:c.hasMsNativeFullScreen?null!==d.msFullscreenElement:void 0},c.requestFullScreen=function(a){c.hasWebkitNativeFullScreen?a.webkitRequestFullScreen():c.hasMozNativeFullScreen?a.mozRequestFullScreen():c.hasMsNativeFullScreen&&a.msRequestFullscreen()},c.cancelFullScreen=function(){c.hasWebkitNativeFullScreen?document.webkitCancelFullScreen():c.hasMozNativeFullScreen?document.mozCancelFullScreen():c.hasMsNativeFullScreen&&document.msExitFullscreen()}),c.hasSemiNativeFullScreen&&f.match(/mac os x 10_5/i)&&(c.hasNativeFullScreen=!1,c.hasSemiNativeFullScreen=!1)}},mejs.MediaFeatures.init(),mejs.HtmlMediaElement={pluginType:"native",isFullScreen:!1,setCurrentTime:function(a){this.currentTime=a},setMuted:function(a){this.muted=a},setVolume:function(a){this.volume=a},stop:function(){this.pause()},setSrc:function(a){for(var b=this.getElementsByTagName("source");b.length>0;)this.removeChild(b[0]);if("string"==typeof a)this.src=a;else{var c,d;for(c=0;c<a.length;c++)if(d=a[c],this.canPlayType(d.type)){this.src=d.src;break}}},setVideoSize:function(a,b){this.width=a,this.height=b}},mejs.PluginMediaElement=function(a,b,c){this.id=a,this.pluginType=b,this.src=c,this.events={},this.attributes={}},mejs.PluginMediaElement.prototype={pluginElement:null,pluginType:"",isFullScreen:!1,playbackRate:-1,defaultPlaybackRate:-1,seekable:[],played:[],paused:!0,ended:!1,seeking:!1,duration:0,error:null,tagName:"",muted:!1,volume:1,currentTime:0,play:function(){null!=this.pluginApi&&("youtube"==this.pluginType||"vimeo"==this.pluginType?this.pluginApi.playVideo():this.pluginApi.playMedia(),this.paused=!1)},load:function(){null!=this.pluginApi&&("youtube"==this.pluginType||"vimeo"==this.pluginType||this.pluginApi.loadMedia(),this.paused=!1)},pause:function(){null!=this.pluginApi&&("youtube"==this.pluginType||"vimeo"==this.pluginType?this.pluginApi.pauseVideo():this.pluginApi.pauseMedia(),this.paused=!0)},stop:function(){null!=this.pluginApi&&("youtube"==this.pluginType||"vimeo"==this.pluginType?this.pluginApi.stopVideo():this.pluginApi.stopMedia(),this.paused=!0)},canPlayType:function(a){var b,c,d,e=mejs.plugins[this.pluginType];for(b=0;b<e.length;b++)if(d=e[b],mejs.PluginDetector.hasPluginVersion(this.pluginType,d.version))for(c=0;c<d.types.length;c++)if(a==d.types[c])return"probably";return""},positionFullscreenButton:function(a,b,c){null!=this.pluginApi&&this.pluginApi.positionFullscreenButton&&this.pluginApi.positionFullscreenButton(Math.floor(a),Math.floor(b),c)},hideFullscreenButton:function(){null!=this.pluginApi&&this.pluginApi.hideFullscreenButton&&this.pluginApi.hideFullscreenButton()},setSrc:function(a){if("string"==typeof a)this.pluginApi.setSrc(mejs.Utility.absolutizeUrl(a)),this.src=mejs.Utility.absolutizeUrl(a);else{var b,c;for(b=0;b<a.length;b++)if(c=a[b],this.canPlayType(c.type)){this.pluginApi.setSrc(mejs.Utility.absolutizeUrl(c.src)),this.src=mejs.Utility.absolutizeUrl(c.src);break}}},setCurrentTime:function(a){null!=this.pluginApi&&("youtube"==this.pluginType||"vimeo"==this.pluginType?this.pluginApi.seekTo(a):this.pluginApi.setCurrentTime(a),this.currentTime=a)},setVolume:function(a){null!=this.pluginApi&&("youtube"==this.pluginType?this.pluginApi.setVolume(100*a):this.pluginApi.setVolume(a),this.volume=a)},setMuted:function(a){null!=this.pluginApi&&("youtube"==this.pluginType?(a?this.pluginApi.mute():this.pluginApi.unMute(),this.muted=a,this.dispatchEvent({type:"volumechange"})):this.pluginApi.setMuted(a),this.muted=a)},setVideoSize:function(a,b){this.pluginElement&&this.pluginElement.style&&(this.pluginElement.style.width=a+"px",this.pluginElement.style.height=b+"px"),null!=this.pluginApi&&this.pluginApi.setVideoSize&&this.pluginApi.setVideoSize(a,b)},setFullscreen:function(a){null!=this.pluginApi&&this.pluginApi.setFullscreen&&this.pluginApi.setFullscreen(a)},enterFullScreen:function(){null!=this.pluginApi&&this.pluginApi.setFullscreen&&this.setFullscreen(!0)},exitFullScreen:function(){null!=this.pluginApi&&this.pluginApi.setFullscreen&&this.setFullscreen(!1)},addEventListener:function(a,b,c){this.events[a]=this.events[a]||[],this.events[a].push(b)},removeEventListener:function(a,b){if(!a)return this.events={},!0;var c=this.events[a];if(!c)return!0;if(!b)return this.events[a]=[],!0;for(var d=0;d<c.length;d++)if(c[d]===b)return this.events[a].splice(d,1),!0;return!1},dispatchEvent:function(a){var b,c=this.events[a.type];if(c)for(b=0;b<c.length;b++)c[b].apply(this,[a])},hasAttribute:function(a){return a in this.attributes},removeAttribute:function(a){delete this.attributes[a]},getAttribute:function(a){return this.hasAttribute(a)?this.attributes[a]:""},setAttribute:function(a,b){this.attributes[a]=b},remove:function(){mejs.Utility.removeSwf(this.pluginElement.id),mejs.MediaPluginBridge.unregisterPluginElement(this.pluginElement.id)}},mejs.MediaPluginBridge={pluginMediaElements:{},htmlMediaElements:{},registerPluginElement:function(a,b,c){this.pluginMediaElements[a]=b,this.htmlMediaElements[a]=c},unregisterPluginElement:function(a){delete this.pluginMediaElements[a],delete this.htmlMediaElements[a]},initPlugin:function(a){var b=this.pluginMediaElements[a],c=this.htmlMediaElements[a];if(b){switch(b.pluginType){case"flash":b.pluginElement=b.pluginApi=document.getElementById(a);break;case"silverlight":b.pluginElement=document.getElementById(b.id),b.pluginApi=b.pluginElement.Content.MediaElementJS}null!=b.pluginApi&&b.success&&b.success(b,c)}},fireEvent:function(a,b,c){var d,e,f,g=this.pluginMediaElements[a];if(g){d={type:b,target:g};for(e in c)g[e]=c[e],d[e]=c[e];f=c.bufferedTime||0,d.target.buffered=d.buffered={start:function(a){return 0},end:function(a){return f},length:1},g.dispatchEvent(d)}}},mejs.MediaElementDefaults={mode:"auto",plugins:["flash","silverlight","youtube","vimeo"],enablePluginDebug:!1,httpsBasicAuthSite:!1,type:"",pluginPath:mejs.Utility.getScriptPath(["mediaelement.js","mediaelement.min.js","mediaelement-and-player.js","mediaelement-and-player.min.js"]),flashName:"flashmediaelement.swf",flashStreamer:"",flashScriptAccess:"sameDomain",enablePluginSmoothing:!1,enablePseudoStreaming:!1,pseudoStreamingStartQueryParam:"start",silverlightName:"silverlightmediaelement.xap",defaultVideoWidth:480,defaultVideoHeight:270,pluginWidth:-1,pluginHeight:-1,pluginVars:[],timerRate:250,startVolume:.8,success:function(){},error:function(){}},mejs.MediaElement=function(a,b){return mejs.HtmlMediaElementShim.create(a,b)},mejs.HtmlMediaElementShim={create:function(a,b){var c,d,e=mejs.MediaElementDefaults,f="string"==typeof a?document.getElementById(a):a,g=f.tagName.toLowerCase(),h="audio"===g||"video"===g,i=h?f.getAttribute("src"):f.getAttribute("href"),j=f.getAttribute("poster"),k=f.getAttribute("autoplay"),l=f.getAttribute("preload"),m=f.getAttribute("controls");for(d in b)e[d]=b[d];return i="undefined"==typeof i||null===i||""==i?null:i,j="undefined"==typeof j||null===j?"":j,l="undefined"==typeof l||null===l||"false"===l?"none":l,k=!("undefined"==typeof k||null===k||"false"===k),m=!("undefined"==typeof m||null===m||"false"===m),c=this.determinePlayback(f,e,mejs.MediaFeatures.supportsMediaTag,h,i),c.url=null!==c.url?mejs.Utility.absolutizeUrl(c.url):"","native"==c.method?(mejs.MediaFeatures.isBustedAndroid&&(f.src=c.url,f.addEventListener("click",function(){f.play()},!1)),this.updateNative(c,e,k,l)):""!==c.method?this.createPlugin(c,e,j,k,l,m):(this.createErrorMessage(c,e,j),this)},determinePlayback:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,n,o,p,q=[],r={method:"",url:"",htmlMediaElement:a,isVideo:"audio"!=a.tagName.toLowerCase()};if("undefined"!=typeof b.type&&""!==b.type)if("string"==typeof b.type)q.push({type:b.type,url:e});else for(f=0;f<b.type.length;f++)q.push({type:b.type[f],url:e});else if(null!==e)k=this.formatType(e,a.getAttribute("type")),q.push({type:k,url:e});else for(f=0;f<a.childNodes.length;f++)j=a.childNodes[f],1==j.nodeType&&"source"==j.tagName.toLowerCase()&&(e=j.getAttribute("src"),k=this.formatType(e,j.getAttribute("type")),p=j.getAttribute("media"),(!p||!window.matchMedia||window.matchMedia&&window.matchMedia(p).matches)&&q.push({type:k,url:e}));if(!d&&q.length>0&&null!==q[0].url&&this.getTypeFromFile(q[0].url).indexOf("audio")>-1&&(r.isVideo=!1),mejs.MediaFeatures.isBustedAndroid&&(a.canPlayType=function(a){return null!==a.match(/video\/(mp4|m4v)/gi)?"maybe":""}),mejs.MediaFeatures.isChromium&&(a.canPlayType=function(a){return null!==a.match(/video\/(webm|ogv|ogg)/gi)?"maybe":""}),c&&("auto"===b.mode||"auto_plugin"===b.mode||"native"===b.mode)&&(!mejs.MediaFeatures.isBustedNativeHTTPS||b.httpsBasicAuthSite!==!0)){for(d||(o=document.createElement(r.isVideo?"video":"audio"),a.parentNode.insertBefore(o,a),a.style.display="none",r.htmlMediaElement=a=o),f=0;f<q.length;f++)if("video/m3u8"==q[f].type||""!==a.canPlayType(q[f].type).replace(/no/,"")||""!==a.canPlayType(q[f].type.replace(/mp3/,"mpeg")).replace(/no/,"")||""!==a.canPlayType(q[f].type.replace(/m4a/,"mp4")).replace(/no/,"")){r.method="native",r.url=q[f].url;break}if("native"===r.method&&(null!==r.url&&(a.src=r.url),"auto_plugin"!==b.mode))return r}if("auto"===b.mode||"auto_plugin"===b.mode||"shim"===b.mode)for(f=0;f<q.length;f++)for(k=q[f].type,g=0;g<b.plugins.length;g++)for(l=b.plugins[g],m=mejs.plugins[l],h=0;h<m.length;h++)if(n=m[h],null==n.version||mejs.PluginDetector.hasPluginVersion(l,n.version))for(i=0;i<n.types.length;i++)if(k.toLowerCase()==n.types[i].toLowerCase())return r.method=l,r.url=q[f].url,r;return"auto_plugin"===b.mode&&"native"===r.method?r:(""===r.method&&q.length>0&&(r.url=q[0].url),r)},formatType:function(a,b){return a&&!b?this.getTypeFromFile(a):b&&~b.indexOf(";")?b.substr(0,b.indexOf(";")):b},getTypeFromFile:function(a){a=a.split("?")[0];var b=a.substring(a.lastIndexOf(".")+1).toLowerCase(),c=/(mp4|m4v|ogg|ogv|m3u8|webm|webmv|flv|wmv|mpeg|mov)/gi.test(b)?"video/":"audio/";return this.getTypeFromExtension(b,c)},getTypeFromExtension:function(a,b){switch(b=b||"",a){case"mp4":case"m4v":case"m4a":case"f4v":case"f4a":return b+"mp4";case"flv":return b+"x-flv";case"webm":case"webma":case"webmv":return b+"webm";case"ogg":case"oga":case"ogv":return b+"ogg";case"m3u8":return"application/x-mpegurl";case"ts":return b+"mp2t";default:return b+a}},createErrorMessage:function(a,b,c){var d=a.htmlMediaElement,e=document.createElement("div"),f=b.customError;e.className="me-cannotplay";try{e.style.width=d.width+"px",e.style.height=d.height+"px"}catch(g){}f||(f='<a href="'+a.url+'">',""!==c&&(f+='<img src="'+c+'" width="100%" height="100%" alt="" />'),f+="<span>"+mejs.i18n.t("Download File")+"</span></a>"),e.innerHTML=f,d.parentNode.insertBefore(e,d),d.style.display="none",b.error(d)},createPlugin:function(a,b,c,d,e,f){var g,h,i,j=a.htmlMediaElement,k=1,l=1,m="me_"+a.method+"_"+mejs.meIndex++,n=new mejs.PluginMediaElement(m,a.method,a.url),o=document.createElement("div");n.tagName=j.tagName;for(var p=0;p<j.attributes.length;p++){var q=j.attributes[p];q.specified&&n.setAttribute(q.name,q.value)}for(h=j.parentNode;null!==h&&null!=h.tagName&&"body"!==h.tagName.toLowerCase()&&null!=h.parentNode&&null!=h.parentNode.tagName&&null!=h.parentNode.constructor&&"ShadowRoot"===h.parentNode.constructor.name;){if("p"===h.parentNode.tagName.toLowerCase()){h.parentNode.parentNode.insertBefore(h,h.parentNode);break}h=h.parentNode}switch(a.isVideo?(k=b.pluginWidth>0?b.pluginWidth:b.videoWidth>0?b.videoWidth:null!==j.getAttribute("width")?j.getAttribute("width"):b.defaultVideoWidth,l=b.pluginHeight>0?b.pluginHeight:b.videoHeight>0?b.videoHeight:null!==j.getAttribute("height")?j.getAttribute("height"):b.defaultVideoHeight,k=mejs.Utility.encodeUrl(k),l=mejs.Utility.encodeUrl(l)):b.enablePluginDebug&&(k=320,l=240),n.success=b.success,mejs.MediaPluginBridge.registerPluginElement(m,n,j),o.className="me-plugin",o.id=m+"_container",a.isVideo?j.parentNode.insertBefore(o,j):document.body.insertBefore(o,document.body.childNodes[0]),i=["id="+m,"jsinitfunction=mejs.MediaPluginBridge.initPlugin","jscallbackfunction=mejs.MediaPluginBridge.fireEvent","isvideo="+(a.isVideo?"true":"false"),"autoplay="+(d?"true":"false"),"preload="+e,"width="+k,"startvolume="+b.startVolume,"timerrate="+b.timerRate,"flashstreamer="+b.flashStreamer,"height="+l,"pseudostreamstart="+b.pseudoStreamingStartQueryParam],null!==a.url&&("flash"==a.method?i.push("file="+mejs.Utility.encodeUrl(a.url)):i.push("file="+a.url)),b.enablePluginDebug&&i.push("debug=true"),b.enablePluginSmoothing&&i.push("smoothing=true"),b.enablePseudoStreaming&&i.push("pseudostreaming=true"),f&&i.push("controls=true"),b.pluginVars&&(i=i.concat(b.pluginVars)),a.method){case"silverlight":o.innerHTML='<object data="data:application/x-silverlight-2," type="application/x-silverlight-2" id="'+m+'" name="'+m+'" width="'+k+'" height="'+l+'" class="mejs-shim"><param name="initParams" value="'+i.join(",")+'" /><param name="windowless" value="true" /><param name="background" value="black" /><param name="minRuntimeVersion" value="3.0.0.0" /><param name="autoUpgrade" value="true" /><param name="source" value="'+b.pluginPath+b.silverlightName+'" /></object>';break;case"flash":mejs.MediaFeatures.isIE?(g=document.createElement("div"),o.appendChild(g),g.outerHTML='<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" codebase="//download.macromedia.com/pub/shockwave/cabs/flash/swflash.cab" id="'+m+'" width="'+k+'" height="'+l+'" class="mejs-shim"><param name="movie" value="'+b.pluginPath+b.flashName+"?x="+new Date+'" /><param name="flashvars" value="'+i.join("&amp;")+'" /><param name="quality" value="high" /><param name="bgcolor" value="#000000" /><param name="wmode" value="transparent" /><param name="allowScriptAccess" value="'+b.flashScriptAccess+'" /><param name="allowFullScreen" value="true" /><param name="scale" value="default" /></object>'):o.innerHTML='<embed id="'+m+'" name="'+m+'" play="true" loop="false" quality="high" bgcolor="#000000" wmode="transparent" allowScriptAccess="'+b.flashScriptAccess+'" allowFullScreen="true" type="application/x-shockwave-flash" pluginspage="//www.macromedia.com/go/getflashplayer" src="'+b.pluginPath+b.flashName+'" flashvars="'+i.join("&")+'" width="'+k+'" height="'+l+'" scale="default"class="mejs-shim"></embed>';break;case"youtube":var r;-1!=a.url.lastIndexOf("youtu.be")?(r=a.url.substr(a.url.lastIndexOf("/")+1),-1!=r.indexOf("?")&&(r=r.substr(0,r.indexOf("?")))):r=a.url.substr(a.url.lastIndexOf("=")+1),youtubeSettings={container:o,containerId:o.id,pluginMediaElement:n,pluginId:m,videoId:r,height:l,width:k},mejs.PluginDetector.hasPluginVersion("flash",[10,0,0])?mejs.YouTubeApi.createFlash(youtubeSettings,b):mejs.YouTubeApi.enqueueIframe(youtubeSettings);break;case"vimeo":var s=m+"_player";if(n.vimeoid=a.url.substr(a.url.lastIndexOf("/")+1),o.innerHTML='<iframe src="//player.vimeo.com/video/'+n.vimeoid+"?api=1&portrait=0&byline=0&title=0&player_id="+s+'" width="'+k+'" height="'+l+'" frameborder="0" class="mejs-shim" id="'+s+'" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>',"function"==typeof $f){var t=$f(o.childNodes[0]);t.addEvent("ready",function(){function a(a,b,c,d){var e={type:c,target:b};"timeupdate"==c&&(b.currentTime=e.currentTime=d.seconds,b.duration=e.duration=d.duration),b.dispatchEvent(e)}t.playVideo=function(){t.api("play")},t.stopVideo=function(){t.api("unload")},t.pauseVideo=function(){t.api("pause")},t.seekTo=function(a){t.api("seekTo",a)},t.setVolume=function(a){t.api("setVolume",a)},t.setMuted=function(a){a?(t.lastVolume=t.api("getVolume"),t.api("setVolume",0)):(t.api("setVolume",t.lastVolume),delete t.lastVolume)},t.addEvent("play",function(){a(t,n,"play"),a(t,n,"playing")}),t.addEvent("pause",function(){a(t,n,"pause")}),t.addEvent("finish",function(){a(t,n,"ended")}),t.addEvent("playProgress",function(b){a(t,n,"timeupdate",b)}),n.pluginElement=o,n.pluginApi=t,mejs.MediaPluginBridge.initPlugin(m)})}else console.warn("You need to include froogaloop for vimeo to work")}return j.style.display="none",j.removeAttribute("autoplay"),n},updateNative:function(a,b,c,d){var e,f=a.htmlMediaElement;for(e in mejs.HtmlMediaElement)f[e]=mejs.HtmlMediaElement[e];return b.success(f,f),f}},mejs.YouTubeApi={isIframeStarted:!1,isIframeLoaded:!1,loadIframeApi:function(){if(!this.isIframeStarted){var a=document.createElement("script");a.src="//www.youtube.com/player_api";var b=document.getElementsByTagName("script")[0];b.parentNode.insertBefore(a,b),this.isIframeStarted=!0}},iframeQueue:[],enqueueIframe:function(a){this.isLoaded?this.createIframe(a):(this.loadIframeApi(),this.iframeQueue.push(a))},createIframe:function(a){var b=a.pluginMediaElement,c=new YT.Player(a.containerId,{height:a.height,width:a.width,videoId:a.videoId,playerVars:{controls:0},events:{onReady:function(){a.pluginMediaElement.pluginApi=c,mejs.MediaPluginBridge.initPlugin(a.pluginId),setInterval(function(){mejs.YouTubeApi.createEvent(c,b,"timeupdate")},250)},onStateChange:function(a){mejs.YouTubeApi.handleStateChange(a.data,c,b)}}})},createEvent:function(a,b,c){var d={type:c,target:b};if(a&&a.getDuration){b.currentTime=d.currentTime=a.getCurrentTime(),b.duration=d.duration=a.getDuration(),d.paused=b.paused,d.ended=b.ended,d.muted=a.isMuted(),d.volume=a.getVolume()/100,d.bytesTotal=a.getVideoBytesTotal(),d.bufferedBytes=a.getVideoBytesLoaded();var e=d.bufferedBytes/d.bytesTotal*d.duration;d.target.buffered=d.buffered={start:function(a){return 0},end:function(a){return e},length:1}}b.dispatchEvent(d)},iFrameReady:function(){for(this.isLoaded=!0,this.isIframeLoaded=!0;this.iframeQueue.length>0;){var a=this.iframeQueue.pop();this.createIframe(a)}},flashPlayers:{},createFlash:function(a){this.flashPlayers[a.pluginId]=a;var b,c="//www.youtube.com/apiplayer?enablejsapi=1&amp;playerapiid="+a.pluginId+"&amp;version=3&amp;autoplay=0&amp;controls=0&amp;modestbranding=1&loop=0";mejs.MediaFeatures.isIE?(b=document.createElement("div"),a.container.appendChild(b),b.outerHTML='<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" codebase="//download.macromedia.com/pub/shockwave/cabs/flash/swflash.cab" id="'+a.pluginId+'" width="'+a.width+'" height="'+a.height+'" class="mejs-shim"><param name="movie" value="'+c+'" /><param name="wmode" value="transparent" /><param name="allowScriptAccess" value="'+options.flashScriptAccess+'" /><param name="allowFullScreen" value="true" /></object>'):a.container.innerHTML='<object type="application/x-shockwave-flash" id="'+a.pluginId+'" data="'+c+'" width="'+a.width+'" height="'+a.height+'" style="visibility: visible; " class="mejs-shim"><param name="allowScriptAccess" value="'+options.flashScriptAccess+'"><param name="wmode" value="transparent"></object>'},flashReady:function(a){var b=this.flashPlayers[a],c=document.getElementById(a),d=b.pluginMediaElement;d.pluginApi=d.pluginElement=c,mejs.MediaPluginBridge.initPlugin(a),c.cueVideoById(b.videoId);var e=b.containerId+"_callback";window[e]=function(a){mejs.YouTubeApi.handleStateChange(a,c,d)},c.addEventListener("onStateChange",e),setInterval(function(){mejs.YouTubeApi.createEvent(c,d,"timeupdate")},250),mejs.YouTubeApi.createEvent(c,d,"canplay")},handleStateChange:function(a,b,c){switch(a){case-1:c.paused=!0,c.ended=!0,mejs.YouTubeApi.createEvent(b,c,"loadedmetadata");break;case 0:c.paused=!1,c.ended=!0,mejs.YouTubeApi.createEvent(b,c,"ended");break;case 1:c.paused=!1,c.ended=!1,mejs.YouTubeApi.createEvent(b,c,"play"),mejs.YouTubeApi.createEvent(b,c,"playing");break;case 2:c.paused=!0,c.ended=!1,mejs.YouTubeApi.createEvent(b,c,"pause");break;case 3:mejs.YouTubeApi.createEvent(b,c,"progress");break;case 5:}}},window.onYouTubePlayerAPIReady=function(){mejs.YouTubeApi.iFrameReady()},window.onYouTubePlayerReady=function(a){mejs.YouTubeApi.flashReady(a)},window.mejs=mejs,window.MediaElement=mejs.MediaElement,function(a,b,c){"use strict";var d={locale:{language:b.i18n&&b.i18n.locale.language||"",strings:b.i18n&&b.i18n.locale.strings||{}},ietf_lang_regex:/^(x\-)?[a-z]{2,}(\-\w{2,})?(\-\w{2,})?$/,methods:{}};d.getLanguage=function(){var a=d.locale.language||window.navigator.userLanguage||window.navigator.language;return d.ietf_lang_regex.exec(a)?a:null},"undefined"!=typeof mejsL10n&&(d.locale.language=mejsL10n.language),d.methods.checkPlain=function(a){var b,c,d={"&":"&amp;",'"':"&quot;","<":"&lt;",">":"&gt;"};a=String(a);for(b in d)d.hasOwnProperty(b)&&(c=new RegExp(b,"g"),a=a.replace(c,d[b]));return a},d.methods.t=function(a,b){return d.locale.strings&&d.locale.strings[b.context]&&d.locale.strings[b.context][a]&&(a=d.locale.strings[b.context][a]),d.methods.checkPlain(a)},d.t=function(a,b){if("string"==typeof a&&a.length>0){var c=d.getLanguage();return b=b||{context:c},d.methods.t(a,b)}throw{name:"InvalidArgumentException",message:"First argument is either not a string or empty."}},b.i18n=d}(document,mejs),function(a,b){"use strict";"undefined"!=typeof mejsL10n&&(a[mejsL10n.language]=mejsL10n.strings)}(mejs.i18n.locale.strings),/*!
 *
 * MediaElementPlayer
 * http://mediaelementjs.com/
 *
 * Creates a controller bar for HTML5 <video> add <audio> tags
 * using jQuery and MediaElement.js (HTML5 Flash/Silverlight wrapper)
 *
 * Copyright 2010-2013, John Dyer (http://j.hn/)
 * License: MIT
 *
 */
"undefined"!=typeof jQuery?mejs.$=jQuery:"undefined"!=typeof Zepto?(mejs.$=Zepto,Zepto.fn.outerWidth=function(a){var b=$(this).width();return a&&(b+=parseInt($(this).css("margin-right"),10),b+=parseInt($(this).css("margin-left"),10)),b}):"undefined"!=typeof ender&&(mejs.$=ender),function(a){mejs.MepDefaults={poster:"",showPosterWhenEnded:!1,defaultVideoWidth:480,defaultVideoHeight:270,videoWidth:-1,videoHeight:-1,defaultAudioWidth:400,defaultAudioHeight:30,defaultSeekBackwardInterval:function(a){return.05*a.duration},defaultSeekForwardInterval:function(a){return.05*a.duration},setDimensions:!0,audioWidth:-1,audioHeight:-1,startVolume:.8,loop:!1,autoRewind:!0,enableAutosize:!0,timeFormat:"",alwaysShowHours:!1,showTimecodeFrameCount:!1,framesPerSecond:25,autosizeProgress:!0,alwaysShowControls:!1,hideVideoControlsOnLoad:!1,clickToPlayPause:!0,iPadUseNativeControls:!1,iPhoneUseNativeControls:!1,AndroidUseNativeControls:!1,features:["playpause","current","progress","duration","tracks","volume","fullscreen"],isVideo:!0,enableKeyboard:!0,pauseOtherPlayers:!0,keyActions:[{keys:[32,179],action:function(a,b){b.paused||b.ended?b.play():b.pause()}},{keys:[38],action:function(a,b){a.container.find(".mejs-volume-slider").css("display","block"),a.isVideo&&(a.showControls(),a.startControlsTimer());var c=Math.min(b.volume+.1,1);b.setVolume(c)}},{keys:[40],action:function(a,b){a.container.find(".mejs-volume-slider").css("display","block"),a.isVideo&&(a.showControls(),a.startControlsTimer());var c=Math.max(b.volume-.1,0);b.setVolume(c)}},{keys:[37,227],action:function(a,b){if(!isNaN(b.duration)&&b.duration>0){a.isVideo&&(a.showControls(),a.startControlsTimer());var c=Math.max(b.currentTime-a.options.defaultSeekBackwardInterval(b),0);b.setCurrentTime(c)}}},{keys:[39,228],action:function(a,b){if(!isNaN(b.duration)&&b.duration>0){a.isVideo&&(a.showControls(),a.startControlsTimer());var c=Math.min(b.currentTime+a.options.defaultSeekForwardInterval(b),b.duration);b.setCurrentTime(c)}}},{keys:[70],action:function(a,b){"undefined"!=typeof a.enterFullScreen&&(a.isFullScreen?a.exitFullScreen():a.enterFullScreen())}},{keys:[77],action:function(a,b){a.container.find(".mejs-volume-slider").css("display","block"),a.isVideo&&(a.showControls(),a.startControlsTimer()),a.media.muted?a.setMuted(!1):a.setMuted(!0)}}]},mejs.mepIndex=0,mejs.players={},mejs.MediaElementPlayer=function(b,c){if(!(this instanceof mejs.MediaElementPlayer))return new mejs.MediaElementPlayer(b,c);var d=this;return d.$media=d.$node=a(b),d.node=d.media=d.$media[0],d.node?"undefined"!=typeof d.node.player?d.node.player:("undefined"==typeof c&&(c=d.$node.data("mejsoptions")),d.options=a.extend({},mejs.MepDefaults,c),d.options.timeFormat||(d.options.timeFormat="mm:ss",d.options.alwaysShowHours&&(d.options.timeFormat="hh:mm:ss"),d.options.showTimecodeFrameCount&&(d.options.timeFormat+=":ff")),mejs.Utility.calculateTimeFormat(0,d.options,d.options.framesPerSecond||25),d.id="mep_"+mejs.mepIndex++,mejs.players[d.id]=d,d.init(),d):void 0},mejs.MediaElementPlayer.prototype={hasFocus:!1,controlsAreVisible:!0,init:function(){var b=this,c=mejs.MediaFeatures,d=a.extend(!0,{},b.options,{success:function(a,c){b.meReady(a,c)},error:function(a){b.handleError(a)}}),e=b.media.tagName.toLowerCase();if(b.isDynamic="audio"!==e&&"video"!==e,b.isDynamic?b.isVideo=b.options.isVideo:b.isVideo="audio"!==e&&b.options.isVideo,c.isiPad&&b.options.iPadUseNativeControls||c.isiPhone&&b.options.iPhoneUseNativeControls)b.$media.attr("controls","controls"),c.isiPad&&null!==b.media.getAttribute("autoplay")&&b.play();else if(c.isAndroid&&b.options.AndroidUseNativeControls);else{b.$media.removeAttr("controls");var f=b.isVideo?mejs.i18n.t("Video Player"):mejs.i18n.t("Audio Player");if(a('<span class="mejs-offscreen">'+f+"</span>").insertBefore(b.$media),b.container=a('<div id="'+b.id+'" class="mejs-container '+(mejs.MediaFeatures.svg?"svg":"no-svg")+'" tabindex="0" role="application" aria-label="'+f+'"><div class="mejs-inner"><div class="mejs-mediaelement"></div><div class="mejs-layers"></div><div class="mejs-controls"></div><div class="mejs-clear"></div></div></div>').addClass(b.$media[0].className).insertBefore(b.$media).focus(function(a){if(!b.controlsAreVisible){b.showControls(!0);var c=b.container.find(".mejs-playpause-button > button");c.focus()}}),b.container.addClass((c.isAndroid?"mejs-android ":"")+(c.isiOS?"mejs-ios ":"")+(c.isiPad?"mejs-ipad ":"")+(c.isiPhone?"mejs-iphone ":"")+(b.isVideo?"mejs-video ":"mejs-audio ")),c.isiOS){var g=b.$media.clone();b.container.find(".mejs-mediaelement").append(g),b.$media.remove(),b.$node=b.$media=g,b.node=b.media=g[0]}else b.container.find(".mejs-mediaelement").append(b.$media);b.node.player=b,b.controls=b.container.find(".mejs-controls"),b.layers=b.container.find(".mejs-layers");var h=b.isVideo?"video":"audio",i=h.substring(0,1).toUpperCase()+h.substring(1);b.options[h+"Width"]>0||b.options[h+"Width"].toString().indexOf("%")>-1?b.width=b.options[h+"Width"]:""!==b.media.style.width&&null!==b.media.style.width?b.width=b.media.style.width:null!==b.media.getAttribute("width")?b.width=b.$media.attr("width"):b.width=b.options["default"+i+"Width"],b.options[h+"Height"]>0||b.options[h+"Height"].toString().indexOf("%")>-1?b.height=b.options[h+"Height"]:""!==b.media.style.height&&null!==b.media.style.height?b.height=b.media.style.height:null!==b.$media[0].getAttribute("height")?b.height=b.$media.attr("height"):b.height=b.options["default"+i+"Height"],b.setPlayerSize(b.width,b.height),d.pluginWidth=b.width,d.pluginHeight=b.height}mejs.MediaElement(b.$media[0],d),"undefined"!=typeof b.container&&b.controlsAreVisible&&b.container.trigger("controlsshown")},showControls:function(a){var b=this;a="undefined"==typeof a||a,b.controlsAreVisible||(a?(b.controls.css("visibility","visible").stop(!0,!0).fadeIn(200,function(){b.controlsAreVisible=!0,b.container.trigger("controlsshown")}),b.container.find(".mejs-control").css("visibility","visible").stop(!0,!0).fadeIn(200,function(){b.controlsAreVisible=!0})):(b.controls.css("visibility","visible").css("display","block"),b.container.find(".mejs-control").css("visibility","visible").css("display","block"),b.controlsAreVisible=!0,b.container.trigger("controlsshown")),b.setControlsSize())},hideControls:function(b){var c=this;b="undefined"==typeof b||b,!c.controlsAreVisible||c.options.alwaysShowControls||c.keyboardAction||(b?(c.controls.stop(!0,!0).fadeOut(200,function(){a(this).css("visibility","hidden").css("display","block"),c.controlsAreVisible=!1,c.container.trigger("controlshidden")}),c.container.find(".mejs-control").stop(!0,!0).fadeOut(200,function(){a(this).css("visibility","hidden").css("display","block")})):(c.controls.css("visibility","hidden").css("display","block"),c.container.find(".mejs-control").css("visibility","hidden").css("display","block"),c.controlsAreVisible=!1,c.container.trigger("controlshidden")))},controlsTimer:null,startControlsTimer:function(a){var b=this;a="undefined"!=typeof a?a:1500,b.killControlsTimer("start"),b.controlsTimer=setTimeout(function(){b.hideControls(),b.killControlsTimer("hide")},a)},killControlsTimer:function(a){var b=this;null!==b.controlsTimer&&(clearTimeout(b.controlsTimer),delete b.controlsTimer,b.controlsTimer=null)},controlsEnabled:!0,disableControls:function(){var a=this;a.killControlsTimer(),a.hideControls(!1),this.controlsEnabled=!1},enableControls:function(){var a=this;a.showControls(!1),a.controlsEnabled=!0},meReady:function(b,c){var d,e,f=this,g=mejs.MediaFeatures,h=c.getAttribute("autoplay"),i=!("undefined"==typeof h||null===h||"false"===h);if(!f.created){if(f.created=!0,f.media=b,f.domNode=c,!(g.isAndroid&&f.options.AndroidUseNativeControls||g.isiPad&&f.options.iPadUseNativeControls||g.isiPhone&&f.options.iPhoneUseNativeControls)){f.buildposter(f,f.controls,f.layers,f.media),f.buildkeyboard(f,f.controls,f.layers,f.media),f.buildoverlays(f,f.controls,f.layers,f.media),f.findTracks();for(d in f.options.features)if(e=f.options.features[d],f["build"+e])try{f["build"+e](f,f.controls,f.layers,f.media)}catch(j){}f.container.trigger("controlsready"),f.setPlayerSize(f.width,f.height),f.setControlsSize(),f.isVideo&&(mejs.MediaFeatures.hasTouch?f.$media.bind("touchstart",function(){f.controlsAreVisible?f.hideControls(!1):f.controlsEnabled&&f.showControls(!1)}):(f.clickToPlayPauseCallback=function(){f.options.clickToPlayPause&&(f.media.paused?f.play():f.pause())},f.media.addEventListener("click",f.clickToPlayPauseCallback,!1),f.container.bind("mouseenter mouseover",function(){f.controlsEnabled&&(f.options.alwaysShowControls||(f.killControlsTimer("enter"),f.showControls(),f.startControlsTimer(2500)))}).bind("mousemove",function(){f.controlsEnabled&&(f.controlsAreVisible||f.showControls(),f.options.alwaysShowControls||f.startControlsTimer(2500))}).bind("mouseleave",function(){f.controlsEnabled&&(f.media.paused||f.options.alwaysShowControls||f.startControlsTimer(1e3))})),f.options.hideVideoControlsOnLoad&&f.hideControls(!1),i&&!f.options.alwaysShowControls&&f.hideControls(),f.options.enableAutosize&&f.media.addEventListener("loadedmetadata",function(a){f.options.videoHeight<=0&&null===f.domNode.getAttribute("height")&&!isNaN(a.target.videoHeight)&&(f.setPlayerSize(a.target.videoWidth,a.target.videoHeight),f.setControlsSize(),f.media.setVideoSize(a.target.videoWidth,a.target.videoHeight))},!1)),b.addEventListener("play",function(){var a;for(a in mejs.players){var b=mejs.players[a];b.id==f.id||!f.options.pauseOtherPlayers||b.paused||b.ended||b.pause(),b.hasFocus=!1}f.hasFocus=!0},!1),f.media.addEventListener("ended",function(b){if(f.options.autoRewind)try{f.media.setCurrentTime(0),window.setTimeout(function(){a(f.container).find(".mejs-overlay-loading").parent().hide()},20)}catch(c){}f.media.pause(),f.setProgressRail&&f.setProgressRail(),f.setCurrentRail&&f.setCurrentRail(),f.options.loop?f.play():!f.options.alwaysShowControls&&f.controlsEnabled&&f.showControls()},!1),f.media.addEventListener("loadedmetadata",function(a){f.updateDuration&&f.updateDuration(),f.updateCurrent&&f.updateCurrent(),f.isFullScreen||(f.setPlayerSize(f.width,f.height),f.setControlsSize())},!1);var k=null;f.media.addEventListener("timeupdate",function(){k!==this.duration&&(k=this.duration,mejs.Utility.calculateTimeFormat(k,f.options,f.options.framesPerSecond||25))},!1),f.container.focusout(function(b){if(b.relatedTarget){var c=a(b.relatedTarget);f.keyboardAction&&0===c.parents(".mejs-container").length&&(f.keyboardAction=!1,f.hideControls(!0))}}),setTimeout(function(){f.setPlayerSize(f.width,f.height),f.setControlsSize()},50),f.globalBind("resize",function(){f.isFullScreen||mejs.MediaFeatures.hasTrueNativeFullScreen&&document.webkitIsFullScreen||f.setPlayerSize(f.width,f.height),f.setControlsSize()}),"youtube"==f.media.pluginType&&(g.isiOS||g.isAndroid)&&f.container.find(".mejs-overlay-play").hide()}i&&"native"==b.pluginType&&f.play(),f.options.success&&("string"==typeof f.options.success?window[f.options.success](f.media,f.domNode,f):f.options.success(f.media,f.domNode,f))}},handleError:function(a){var b=this;b.controls.hide(),b.options.error&&b.options.error(a)},setPlayerSize:function(b,c){var d=this;if(!d.options.setDimensions)return!1;if("undefined"!=typeof b&&(d.width=b),"undefined"!=typeof c&&(d.height=c),d.height.toString().indexOf("%")>0||"none"!==d.$node.css("max-width")&&"t.width"!==d.$node.css("max-width")||d.$node[0].currentStyle&&"100%"===d.$node[0].currentStyle.maxWidth){var e=function(){return d.isVideo?d.media.videoWidth&&d.media.videoWidth>0?d.media.videoWidth:null!==d.media.getAttribute("width")?d.media.getAttribute("width"):d.options.defaultVideoWidth:d.options.defaultAudioWidth}(),f=function(){return d.isVideo?d.media.videoHeight&&d.media.videoHeight>0?d.media.videoHeight:null!==d.media.getAttribute("height")?d.media.getAttribute("height"):d.options.defaultVideoHeight:d.options.defaultAudioHeight}(),g=d.container.parent().closest(":visible").width(),h=d.container.parent().closest(":visible").height(),i=d.isVideo||!d.options.autosizeProgress?parseInt(g*f/e,10):f;isNaN(i)&&(i=h),d.container.parent().length>0&&"body"===d.container.parent()[0].tagName.toLowerCase()&&(g=a(window).width(),i=a(window).height()),i&&g&&(d.container.width(g).height(i),d.$media.add(d.container.find(".mejs-shim")).width("100%").height("100%"),d.isVideo&&d.media.setVideoSize&&d.media.setVideoSize(g,i),d.layers.children(".mejs-layer").width("100%").height("100%"))}else d.container.width(d.width).height(d.height),d.layers.children(".mejs-layer").width(d.width).height(d.height)},setControlsSize:function(){var b=this,c=0,d=0,e=b.controls.find(".mejs-time-rail"),f=b.controls.find(".mejs-time-total"),g=e.siblings(),h=g.last(),i=null;if(b.container.is(":visible")&&e.length&&e.is(":visible")){b.options&&!b.options.autosizeProgress&&(d=parseInt(e.css("width"),10)),0!==d&&d||(g.each(function(){var b=a(this);"absolute"!=b.css("position")&&b.is(":visible")&&(c+=a(this).outerWidth(!0))}),d=b.controls.width()-c-(e.outerWidth(!0)-e.width()));do e.width(d),f.width(d-(f.outerWidth(!0)-f.width())),"absolute"!=h.css("position")&&(i=h.length?h.position():null,d--);while(null!==i&&i.top>0&&d>0);b.container.trigger("controlsresize")}},buildposter:function(b,c,d,e){var f=this,g=a('<div class="mejs-poster mejs-layer"></div>').appendTo(d),h=b.$media.attr("poster");""!==b.options.poster&&(h=b.options.poster),h?f.setPoster(h):g.hide(),e.addEventListener("play",function(){g.hide()},!1),b.options.showPosterWhenEnded&&b.options.autoRewind&&e.addEventListener("ended",function(){g.show()},!1)},setPoster:function(b){var c=this,d=c.container.find(".mejs-poster"),e=d.find("img");0===e.length&&(e=a('<img width="100%" height="100%" alt="" />').appendTo(d)),e.attr("src",b),d.css({"background-image":"url("+b+")"})},buildoverlays:function(b,c,d,e){var f=this;if(b.isVideo){var g=a('<div class="mejs-overlay mejs-layer"><div class="mejs-overlay-loading"><span></span></div></div>').hide().appendTo(d),h=a('<div class="mejs-overlay mejs-layer"><div class="mejs-overlay-error"></div></div>').hide().appendTo(d),i=a('<div class="mejs-overlay mejs-layer mejs-overlay-play"><div class="mejs-overlay-button"></div></div>').appendTo(d).bind("click",function(){f.options.clickToPlayPause&&e.paused&&e.play()});e.addEventListener("play",function(){i.hide(),g.hide(),c.find(".mejs-time-buffering").hide(),h.hide()},!1),e.addEventListener("playing",function(){i.hide(),g.hide(),c.find(".mejs-time-buffering").hide(),h.hide()},!1),e.addEventListener("seeking",function(){g.show(),c.find(".mejs-time-buffering").show()},!1),e.addEventListener("seeked",function(){g.hide(),c.find(".mejs-time-buffering").hide()},!1),e.addEventListener("pause",function(){mejs.MediaFeatures.isiPhone||i.show()},!1),e.addEventListener("waiting",function(){g.show(),c.find(".mejs-time-buffering").show()},!1),e.addEventListener("loadeddata",function(){g.show(),c.find(".mejs-time-buffering").show(),mejs.MediaFeatures.isAndroid&&(e.canplayTimeout=window.setTimeout(function(){if(document.createEvent){var a=document.createEvent("HTMLEvents");return a.initEvent("canplay",!0,!0),e.dispatchEvent(a)}},300))},!1),e.addEventListener("canplay",function(){g.hide(),c.find(".mejs-time-buffering").hide(),clearTimeout(e.canplayTimeout)},!1),e.addEventListener("error",function(a){f.handleError(a),g.hide(),i.hide(),h.show(),h.find(".mejs-overlay-error").html("Error loading this resource")},!1),e.addEventListener("keydown",function(a){f.onkeydown(b,e,a)},!1)}},buildkeyboard:function(b,c,d,e){var f=this;f.container.keydown(function(){f.keyboardAction=!0}),f.globalBind("keydown",function(a){return f.onkeydown(b,e,a)}),f.globalBind("click",function(c){b.hasFocus=0!==a(c.target).closest(".mejs-container").length})},onkeydown:function(a,b,c){if(a.hasFocus&&a.options.enableKeyboard)for(var d=0,e=a.options.keyActions.length;e>d;d++)for(var f=a.options.keyActions[d],g=0,h=f.keys.length;h>g;g++)if(c.keyCode==f.keys[g])return"function"==typeof c.preventDefault&&c.preventDefault(),f.action(a,b,c.keyCode),!1;return!0},findTracks:function(){var b=this,c=b.$media.find("track");b.tracks=[],c.each(function(c,d){d=a(d),b.tracks.push({srclang:d.attr("srclang")?d.attr("srclang").toLowerCase():"",src:d.attr("src"),kind:d.attr("kind"),label:d.attr("label")||"",entries:[],isLoaded:!1})})},changeSkin:function(a){this.container[0].className="mejs-container "+a,this.setPlayerSize(this.width,this.height),this.setControlsSize()},play:function(){this.load(),this.media.play()},pause:function(){try{this.media.pause()}catch(a){}},load:function(){this.isLoaded||this.media.load(),this.isLoaded=!0},setMuted:function(a){this.media.setMuted(a)},setCurrentTime:function(a){this.media.setCurrentTime(a)},getCurrentTime:function(){return this.media.currentTime},setVolume:function(a){this.media.setVolume(a)},getVolume:function(){return this.media.volume},setSrc:function(a){this.media.setSrc(a)},remove:function(){var a,b,c=this;c.container.prev(".mejs-offscreen").remove();for(a in c.options.features)if(b=c.options.features[a],c["clean"+b])try{c["clean"+b](c)}catch(d){}c.isDynamic?c.$node.insertBefore(c.container):(c.$media.prop("controls",!0),c.$node.clone().insertBefore(c.container).show(),c.$node.remove()),"native"!==c.media.pluginType&&c.media.remove(),delete mejs.players[c.id],"object"==typeof c.container&&c.container.remove(),c.globalUnbind(),delete c.node.player},rebuildtracks:function(){var a=this;a.findTracks(),a.buildtracks(a,a.controls,a.layers,a.media)},resetSize:function(){var a=this;setTimeout(function(){a.setPlayerSize(a.width,a.height),a.setControlsSize()},50)}},function(){function b(b,d){var e={d:[],w:[]};return a.each((b||"").split(" "),function(a,b){var f=b+"."+d;0===f.indexOf(".")?(e.d.push(f),e.w.push(f)):e[c.test(b)?"w":"d"].push(f)}),e.d=e.d.join(" "),e.w=e.w.join(" "),e}var c=/^((after|before)print|(before)?unload|hashchange|message|o(ff|n)line|page(hide|show)|popstate|resize|storage)\b/;mejs.MediaElementPlayer.prototype.globalBind=function(c,d,e){var f=this;c=b(c,f.id),c.d&&a(document).bind(c.d,d,e),c.w&&a(window).bind(c.w,d,e)},mejs.MediaElementPlayer.prototype.globalUnbind=function(c,d){var e=this;c=b(c,e.id),c.d&&a(document).unbind(c.d,d),c.w&&a(window).unbind(c.w,d)}}(),"undefined"!=typeof a&&(a.fn.mediaelementplayer=function(b){return b===!1?this.each(function(){var b=a(this).data("mediaelementplayer");b&&b.remove(),a(this).removeData("mediaelementplayer")}):this.each(function(){a(this).data("mediaelementplayer",new mejs.MediaElementPlayer(this,b))}),this},a(document).ready(function(){a(".mejs-player").mediaelementplayer()})),window.MediaElementPlayer=mejs.MediaElementPlayer}(mejs.$),function(a){a.extend(mejs.MepDefaults,{playText:mejs.i18n.t("Play"),pauseText:mejs.i18n.t("Pause")}),a.extend(MediaElementPlayer.prototype,{buildplaypause:function(b,c,d,e){function f(a){"play"===a?(i.removeClass("mejs-play").addClass("mejs-pause"),j.attr({title:h.pauseText,"aria-label":h.pauseText})):(i.removeClass("mejs-pause").addClass("mejs-play"),j.attr({title:h.playText,"aria-label":h.playText}))}var g=this,h=g.options,i=a('<div class="mejs-button mejs-playpause-button mejs-play" ><button type="button" aria-controls="'+g.id+'" title="'+h.playText+'" aria-label="'+h.playText+'"></button></div>').appendTo(c).click(function(a){return a.preventDefault(),e.paused?e.play():e.pause(),!1}),j=i.find("button");f("pse"),e.addEventListener("play",function(){f("play")},!1),e.addEventListener("playing",function(){f("play")},!1),e.addEventListener("pause",function(){f("pse")},!1),e.addEventListener("paused",function(){f("pse")},!1)}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{stopText:"Stop"}),a.extend(MediaElementPlayer.prototype,{buildstop:function(b,c,d,e){var f=this;a('<div class="mejs-button mejs-stop-button mejs-stop"><button type="button" aria-controls="'+f.id+'" title="'+f.options.stopText+'" aria-label="'+f.options.stopText+'"></button></div>').appendTo(c).click(function(){e.paused||e.pause(),e.currentTime>0&&(e.setCurrentTime(0),e.pause(),c.find(".mejs-time-current").width("0px"),c.find(".mejs-time-handle").css("left","0px"),c.find(".mejs-time-float-current").html(mejs.Utility.secondsToTimeCode(0,b.options)),c.find(".mejs-currenttime").html(mejs.Utility.secondsToTimeCode(0,b.options)),d.find(".mejs-poster").show())})}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{progessHelpText:mejs.i18n.t("Use Left/Right Arrow keys to advance one second, Up/Down arrows to advance ten seconds.")}),a.extend(MediaElementPlayer.prototype,{buildprogress:function(b,c,d,e){a('<div class="mejs-time-rail"><span  class="mejs-time-total mejs-time-slider"><span class="mejs-time-buffering"></span><span class="mejs-time-loaded"></span><span class="mejs-time-current"></span><span class="mejs-time-handle"></span><span class="mejs-time-float"><span class="mejs-time-float-current">00:00</span><span class="mejs-time-float-corner"></span></span></span></div>').appendTo(c),c.find(".mejs-time-buffering").hide();var f=this,g=c.find(".mejs-time-total"),h=c.find(".mejs-time-loaded"),i=c.find(".mejs-time-current"),j=c.find(".mejs-time-handle"),k=c.find(".mejs-time-float"),l=c.find(".mejs-time-float-current"),m=c.find(".mejs-time-slider"),n=function(a){var c,d=g.offset(),f=g.width(),h=0,i=0,j=0;c=a.originalEvent&&a.originalEvent.changedTouches?a.originalEvent.changedTouches[0].pageX:a.changedTouches?a.changedTouches[0].pageX:a.pageX,e.duration&&(c<d.left?c=d.left:c>f+d.left&&(c=f+d.left),j=c-d.left,h=j/f,i=.02>=h?0:h*e.duration,o&&i!==e.currentTime&&e.setCurrentTime(i),mejs.MediaFeatures.hasTouch||(k.css("left",j),l.html(mejs.Utility.secondsToTimeCode(i,b.options)),k.show()))},o=!1,p=!1,q=0,r=!1,s=b.options.autoRewind,t=function(a){var c=e.currentTime,d=mejs.i18n.t("Time Slider"),f=mejs.Utility.secondsToTimeCode(c,b.options),g=e.duration;m.attr({"aria-label":d,"aria-valuemin":0,"aria-valuemax":g,"aria-valuenow":c,"aria-valuetext":f,role:"slider",tabindex:0})},u=function(){var a=new Date;a-q>=1e3&&e.play()};m.bind("focus",function(a){b.options.autoRewind=!1}),m.bind("blur",function(a){b.options.autoRewind=s}),m.bind("keydown",function(a){new Date-q>=1e3&&(r=e.paused);var b=a.keyCode,c=e.duration,d=e.currentTime;switch(b){case 37:d-=1;break;case 39:d+=1;break;case 38:d+=Math.floor(.1*c);break;case 40:d-=Math.floor(.1*c);break;case 36:d=0;break;case 35:d=c;break;case 10:return void(e.paused?e.play():e.pause());case 13:return void(e.paused?e.play():e.pause());default:return}return d=0>d?0:d>=c?c:Math.floor(d),q=new Date,r||e.pause(),d<e.duration&&!r&&setTimeout(u,1100),e.setCurrentTime(d),a.preventDefault(),a.stopPropagation(),!1}),g.bind("mousedown touchstart",function(a){(1===a.which||0===a.which)&&(o=!0,n(a),f.globalBind("mousemove.dur touchmove.dur",function(a){n(a)}),f.globalBind("mouseup.dur touchend.dur",function(a){o=!1,k.hide(),f.globalUnbind(".dur")}))}).bind("mouseenter",function(a){p=!0,f.globalBind("mousemove.dur",function(a){n(a)}),mejs.MediaFeatures.hasTouch||k.show()}).bind("mouseleave",function(a){p=!1,o||(f.globalUnbind(".dur"),k.hide())}),e.addEventListener("progress",function(a){b.setProgressRail(a),b.setCurrentRail(a)},!1),e.addEventListener("timeupdate",function(a){b.setProgressRail(a),b.setCurrentRail(a),t(a)},!1),f.container.on("controlsresize",function(){b.setProgressRail(),b.setCurrentRail()}),f.loaded=h,f.total=g,f.current=i,f.handle=j},setProgressRail:function(a){var b=this,c=void 0!==a?a.target:b.media,d=null;c&&c.buffered&&c.buffered.length>0&&c.buffered.end&&c.duration?d=c.buffered.end(c.buffered.length-1)/c.duration:c&&void 0!==c.bytesTotal&&c.bytesTotal>0&&void 0!==c.bufferedBytes?d=c.bufferedBytes/c.bytesTotal:a&&a.lengthComputable&&0!==a.total&&(d=a.loaded/a.total),null!==d&&(d=Math.min(1,Math.max(0,d)),b.loaded&&b.total&&b.loaded.width(b.total.width()*d))},setCurrentRail:function(){var a=this;if(void 0!==a.media.currentTime&&a.media.duration&&a.total&&a.handle){var b=Math.round(a.total.width()*a.media.currentTime/a.media.duration),c=b-Math.round(a.handle.outerWidth(!0)/2);a.current.width(b),a.handle.css("left",c)}}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{duration:-1,timeAndDurationSeparator:"<span> | </span>"}),a.extend(MediaElementPlayer.prototype,{buildcurrent:function(b,c,d,e){var f=this;a('<div class="mejs-time" role="timer" aria-live="off"><span class="mejs-currenttime">'+mejs.Utility.secondsToTimeCode(0,b.options)+"</span></div>").appendTo(c),f.currenttime=f.controls.find(".mejs-currenttime"),e.addEventListener("timeupdate",function(){b.updateCurrent()},!1)},buildduration:function(b,c,d,e){var f=this;c.children().last().find(".mejs-currenttime").length>0?a(f.options.timeAndDurationSeparator+'<span class="mejs-duration">'+mejs.Utility.secondsToTimeCode(f.options.duration,f.options)+"</span>").appendTo(c.find(".mejs-time")):(c.find(".mejs-currenttime").parent().addClass("mejs-currenttime-container"),a('<div class="mejs-time mejs-duration-container"><span class="mejs-duration">'+mejs.Utility.secondsToTimeCode(f.options.duration,f.options)+"</span></div>").appendTo(c)),f.durationD=f.controls.find(".mejs-duration"),e.addEventListener("timeupdate",function(){b.updateDuration()},!1)},updateCurrent:function(){var a=this;a.currenttime&&a.currenttime.html(mejs.Utility.secondsToTimeCode(a.media.currentTime,a.options))},updateDuration:function(){var a=this;a.container.toggleClass("mejs-long-video",a.media.duration>3600),a.durationD&&(a.options.duration>0||a.media.duration)&&a.durationD.html(mejs.Utility.secondsToTimeCode(a.options.duration>0?a.options.duration:a.media.duration,a.options))}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{muteText:mejs.i18n.t("Mute Toggle"),allyVolumeControlText:mejs.i18n.t("Use Up/Down Arrow keys to increase or decrease volume."),hideVolumeOnTouchDevices:!0,audioVolume:"horizontal",videoVolume:"vertical"}),a.extend(MediaElementPlayer.prototype,{buildvolume:function(b,c,d,e){if(!mejs.MediaFeatures.isAndroid&&!mejs.MediaFeatures.isiOS||!this.options.hideVolumeOnTouchDevices){var f=this,g=f.isVideo?f.options.videoVolume:f.options.audioVolume,h="horizontal"==g?a('<div class="mejs-button mejs-volume-button mejs-mute"><button type="button" aria-controls="'+f.id+'" title="'+f.options.muteText+'" aria-label="'+f.options.muteText+'"></button></div><a href="javascript:void(0);" class="mejs-horizontal-volume-slider"><span class="mejs-offscreen">'+f.options.allyVolumeControlText+'</span><div class="mejs-horizontal-volume-total"></div><div class="mejs-horizontal-volume-current"></div><div class="mejs-horizontal-volume-handle"></div></a>').appendTo(c):a('<div class="mejs-button mejs-volume-button mejs-mute"><button type="button" aria-controls="'+f.id+'" title="'+f.options.muteText+'" aria-label="'+f.options.muteText+'"></button><a href="javascript:void(0);" class="mejs-volume-slider"><span class="mejs-offscreen">'+f.options.allyVolumeControlText+'</span><div class="mejs-volume-total"></div><div class="mejs-volume-current"></div><div class="mejs-volume-handle"></div></a></div>').appendTo(c),i=f.container.find(".mejs-volume-slider, .mejs-horizontal-volume-slider"),j=f.container.find(".mejs-volume-total, .mejs-horizontal-volume-total"),k=f.container.find(".mejs-volume-current, .mejs-horizontal-volume-current"),l=f.container.find(".mejs-volume-handle, .mejs-horizontal-volume-handle"),m=function(a,b){if(!i.is(":visible")&&"undefined"==typeof b)return i.show(),m(a,!0),void i.hide();a=Math.max(0,a),a=Math.min(a,1),0===a?(h.removeClass("mejs-mute").addClass("mejs-unmute"),h.children("button").attr("title",mejs.i18n.t("Unmute")).attr("aria-label",mejs.i18n.t("Unmute"))):(h.removeClass("mejs-unmute").addClass("mejs-mute"),h.children("button").attr("title",mejs.i18n.t("Mute")).attr("aria-label",mejs.i18n.t("Mute")));var c=j.position();if("vertical"==g){var d=j.height(),e=d-d*a;l.css("top",Math.round(c.top+e-l.height()/2)),k.height(d-e),k.css("top",c.top+e)}else{var f=j.width(),n=f*a;l.css("left",Math.round(c.left+n-l.width()/2)),k.width(Math.round(n))}},n=function(a){var b=null,c=j.offset();if("vertical"===g){var d=j.height(),f=a.pageY-c.top;if(b=(d-f)/d,0===c.top||0===c.left)return}else{var h=j.width(),i=a.pageX-c.left;b=i/h}b=Math.max(0,b),b=Math.min(b,1),m(b),0===b?e.setMuted(!0):e.setMuted(!1),e.setVolume(b)},o=!1,p=!1;h.hover(function(){i.show(),p=!0},function(){p=!1,o||"vertical"!=g||i.hide()});var q=function(a){var b=Math.floor(100*e.volume);i.attr({"aria-label":mejs.i18n.t("volumeSlider"),"aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":b,"aria-valuetext":b+"%",role:"slider",tabindex:0})};i.bind("mouseover",function(){p=!0}).bind("mousedown",function(a){return n(a),f.globalBind("mousemove.vol",function(a){n(a)}),f.globalBind("mouseup.vol",function(){o=!1,f.globalUnbind(".vol"),p||"vertical"!=g||i.hide()}),o=!0,!1}).bind("keydown",function(a){var b=a.keyCode,c=e.volume;switch(b){case 38:c+=.1;break;case 40:c-=.1;break;default:return!0}return o=!1,m(c),e.setVolume(c),!1}).bind("blur",function(){i.hide()}),h.find("button").click(function(){e.setMuted(!e.muted)}),h.find("button").bind("focus",function(){i.show()}),e.addEventListener("volumechange",function(a){o||(e.muted?(m(0),h.removeClass("mejs-mute").addClass("mejs-unmute")):(m(e.volume),h.removeClass("mejs-unmute").addClass("mejs-mute"))),q(a)},!1),0===b.options.startVolume&&e.setMuted(!0),"native"===e.pluginType&&e.setVolume(b.options.startVolume),f.container.on("controlsresize",function(){m(e.volume)})}}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{usePluginFullScreen:!0,newWindowCallback:function(){return""},fullscreenText:mejs.i18n.t("Fullscreen")}),a.extend(MediaElementPlayer.prototype,{isFullScreen:!1,isNativeFullScreen:!1,isInIframe:!1,buildfullscreen:function(b,c,d,e){if(b.isVideo){if(b.isInIframe=window.location!=window.parent.location,mejs.MediaFeatures.hasTrueNativeFullScreen){var f=function(a){b.isFullScreen&&(mejs.MediaFeatures.isFullScreen()?(b.isNativeFullScreen=!0,b.setControlsSize()):(b.isNativeFullScreen=!1,b.exitFullScreen()))};b.globalBind(mejs.MediaFeatures.fullScreenEventName,f)}var g=this,h=a('<div class="mejs-button mejs-fullscreen-button"><button type="button" aria-controls="'+g.id+'" title="'+g.options.fullscreenText+'" aria-label="'+g.options.fullscreenText+'"></button></div>').appendTo(c);if("native"===g.media.pluginType||!g.options.usePluginFullScreen&&!mejs.MediaFeatures.isFirefox)h.click(function(){var a=mejs.MediaFeatures.hasTrueNativeFullScreen&&mejs.MediaFeatures.isFullScreen()||b.isFullScreen;a?b.exitFullScreen():b.enterFullScreen()});else{var i=null,j=function(){var a,b=document.createElement("x"),c=document.documentElement,d=window.getComputedStyle;return"pointerEvents"in b.style?(b.style.pointerEvents="auto",b.style.pointerEvents="x",c.appendChild(b),a=d&&"auto"===d(b,"").pointerEvents,c.removeChild(b),!!a):!1}();if(j&&!mejs.MediaFeatures.isOpera){var k,l,m=!1,n=function(){if(m){for(var a in o)o[a].hide();h.css("pointer-events",""),g.controls.css("pointer-events",""),g.media.removeEventListener("click",g.clickToPlayPauseCallback),m=!1}},o={},p=["top","left","right","bottom"],q=function(){var a=h.offset().left-g.container.offset().left,b=h.offset().top-g.container.offset().top,c=h.outerWidth(!0),d=h.outerHeight(!0),e=g.container.width(),f=g.container.height();for(k in o)o[k].css({position:"absolute",top:0,left:0});o.top.width(e).height(b),o.left.width(a).height(d).css({top:b}),o.right.width(e-a-c).height(d).css({top:b,left:a+c}),o.bottom.width(e).height(f-d-b).css({top:b+d})};for(g.globalBind("resize",function(){q()}),k=0,l=p.length;l>k;k++)o[p[k]]=a('<div class="mejs-fullscreen-hover" />').appendTo(g.container).mouseover(n).hide();h.on("mouseover",function(){if(!g.isFullScreen){var a=h.offset(),c=b.container.offset();e.positionFullscreenButton(a.left-c.left,a.top-c.top,!1),h.css("pointer-events","none"),g.controls.css("pointer-events","none"),g.media.addEventListener("click",g.clickToPlayPauseCallback);for(k in o)o[k].show();q(),m=!0}}),
e.addEventListener("fullscreenchange",function(a){g.isFullScreen=!g.isFullScreen,g.isFullScreen?g.media.removeEventListener("click",g.clickToPlayPauseCallback):g.media.addEventListener("click",g.clickToPlayPauseCallback),n()}),g.globalBind("mousemove",function(a){if(m){var b=h.offset();(a.pageY<b.top||a.pageY>b.top+h.outerHeight(!0)||a.pageX<b.left||a.pageX>b.left+h.outerWidth(!0))&&(h.css("pointer-events",""),g.controls.css("pointer-events",""),m=!1)}})}else h.on("mouseover",function(){null!==i&&(clearTimeout(i),delete i);var a=h.offset(),c=b.container.offset();e.positionFullscreenButton(a.left-c.left,a.top-c.top,!0)}).on("mouseout",function(){null!==i&&(clearTimeout(i),delete i),i=setTimeout(function(){e.hideFullscreenButton()},1500)})}b.fullscreenBtn=h,g.globalBind("keydown",function(a){(mejs.MediaFeatures.hasTrueNativeFullScreen&&mejs.MediaFeatures.isFullScreen()||g.isFullScreen)&&27==a.keyCode&&b.exitFullScreen()}),g.normalHeight=0,g.normalWidth=0}},cleanfullscreen:function(a){a.exitFullScreen()},containerSizeTimeout:null,enterFullScreen:function(){var b=this;if("native"===b.media.pluginType||!mejs.MediaFeatures.isFirefox&&!b.options.usePluginFullScreen){if(a(document.documentElement).addClass("mejs-fullscreen"),b.normalHeight=b.container.height(),b.normalWidth=b.container.width(),"native"===b.media.pluginType)if(mejs.MediaFeatures.hasTrueNativeFullScreen)mejs.MediaFeatures.requestFullScreen(b.container[0]),b.isInIframe&&setTimeout(function d(){if(b.isNativeFullScreen){var c=window.devicePixelRatio||1,e=.002,f=c*a(window).width(),g=screen.width,h=c*f;Math.abs(g-f)>Math.abs(g-h)&&(f=h);var i=Math.abs(g-f),j=g*e;i>j?b.exitFullScreen():setTimeout(d,500)}},1e3);else if(mejs.MediaFeatures.hasSemiNativeFullScreen)return void b.media.webkitEnterFullscreen();if(b.isInIframe){var c=b.options.newWindowCallback(this);if(""!==c){if(!mejs.MediaFeatures.hasTrueNativeFullScreen)return b.pause(),void window.open(c,b.id,"top=0,left=0,width="+screen.availWidth+",height="+screen.availHeight+",resizable=yes,scrollbars=no,status=no,toolbar=no");setTimeout(function(){b.isNativeFullScreen||(b.pause(),window.open(c,b.id,"top=0,left=0,width="+screen.availWidth+",height="+screen.availHeight+",resizable=yes,scrollbars=no,status=no,toolbar=no"))},250)}}b.container.addClass("mejs-container-fullscreen").width("100%").height("100%"),b.containerSizeTimeout=setTimeout(function(){b.container.css({width:"100%",height:"100%"}),b.setControlsSize()},500),"native"===b.media.pluginType?b.$media.width("100%").height("100%"):(b.container.find(".mejs-shim").width("100%").height("100%"),b.media.setVideoSize(a(window).width(),a(window).height())),b.layers.children("div").width("100%").height("100%"),b.fullscreenBtn&&b.fullscreenBtn.removeClass("mejs-fullscreen").addClass("mejs-unfullscreen"),b.setControlsSize(),b.isFullScreen=!0,b.container.find(".mejs-captions-text").css("font-size",screen.width/b.width*1*100+"%"),b.container.find(".mejs-captions-position").css("bottom","45px"),b.container.trigger("enteredfullscreen")}},exitFullScreen:function(){var b=this;return clearTimeout(b.containerSizeTimeout),"native"!==b.media.pluginType&&mejs.MediaFeatures.isFirefox?void b.media.setFullscreen(!1):(mejs.MediaFeatures.hasTrueNativeFullScreen&&(mejs.MediaFeatures.isFullScreen()||b.isFullScreen)&&mejs.MediaFeatures.cancelFullScreen(),a(document.documentElement).removeClass("mejs-fullscreen"),b.container.removeClass("mejs-container-fullscreen").width(b.normalWidth).height(b.normalHeight),"native"===b.media.pluginType?b.$media.width(b.normalWidth).height(b.normalHeight):(b.container.find(".mejs-shim").width(b.normalWidth).height(b.normalHeight),b.media.setVideoSize(b.normalWidth,b.normalHeight)),b.layers.children("div").width(b.normalWidth).height(b.normalHeight),b.fullscreenBtn.removeClass("mejs-unfullscreen").addClass("mejs-fullscreen"),b.setControlsSize(),b.isFullScreen=!1,b.container.find(".mejs-captions-text").css("font-size",""),b.container.find(".mejs-captions-position").css("bottom",""),void b.container.trigger("exitedfullscreen"))}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{speeds:["2.00","1.50","1.25","1.00","0.75"],defaultSpeed:"1.00",speedChar:"x"}),a.extend(MediaElementPlayer.prototype,{buildspeed:function(b,c,d,e){var f=this;if("native"==f.media.pluginType){for(var g=null,h=null,i=null,j=null,k=[],l=!1,m=0,n=f.options.speeds.length;n>m;m++){var o=f.options.speeds[m];"string"==typeof o?(k.push({name:o+f.options.speedChar,value:o}),o===f.options.defaultSpeed&&(l=!0)):(k.push(o),o.value===f.options.defaultSpeed&&(l=!0))}l||k.push({name:f.options.defaultSpeed+f.options.speedChar,value:f.options.defaultSpeed}),k.sort(function(a,b){return parseFloat(b.value)-parseFloat(a.value)});var p=function(a){for(m=0,n=k.length;n>m;m++)if(k[m].value===a)return k[m].name},q='<div class="mejs-button mejs-speed-button"><button type="button">'+p(f.options.defaultSpeed)+'</button><div class="mejs-speed-selector"><ul>';for(m=0,il=k.length;m<il;m++)j=f.id+"-speed-"+k[m].value,q+='<li><input type="radio" name="speed" value="'+k[m].value+'" id="'+j+'" '+(k[m].value===f.options.defaultSpeed?" checked":"")+' /><label for="'+j+'" '+(k[m].value===f.options.defaultSpeed?' class="mejs-speed-selected"':"")+">"+k[m].name+"</label></li>";q+="</ul></div></div>",g=a(q).appendTo(c),h=g.find(".mejs-speed-selector"),i=f.options.defaultSpeed,h.on("click",'input[type="radio"]',function(){var b=a(this).attr("value");i=b,e.playbackRate=parseFloat(b),g.find("button").html(p(b)),g.find(".mejs-speed-selected").removeClass("mejs-speed-selected"),g.find('input[type="radio"]:checked').next().addClass("mejs-speed-selected")}),g.one("mouseenter focusin",function(){h.height(g.find(".mejs-speed-selector ul").outerHeight(!0)+g.find(".mejs-speed-translations").outerHeight(!0)).css("top",-1*h.height()+"px")})}}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{startLanguage:"",tracksText:mejs.i18n.t("Captions/Subtitles"),tracksAriaLive:!1,hideCaptionsButtonWhenEmpty:!0,toggleCaptionsButtonWhenOnlyOne:!1,slidesSelector:""}),a.extend(MediaElementPlayer.prototype,{hasChapters:!1,cleartracks:function(a,b,c,d){a&&(a.captions&&a.captions.remove(),a.chapters&&a.chapters.remove(),a.captionsText&&a.captionsText.remove(),a.captionsButton&&a.captionsButton.remove())},buildtracks:function(b,c,d,e){if(0!==b.tracks.length){var f,g=this,h=g.options.tracksAriaLive?'role="log" aria-live="assertive" aria-atomic="false"':"";if(g.domNode.textTracks)for(f=g.domNode.textTracks.length-1;f>=0;f--)g.domNode.textTracks[f].mode="hidden";g.cleartracks(b,c,d,e),b.chapters=a('<div class="mejs-chapters mejs-layer"></div>').prependTo(d).hide(),b.captions=a('<div class="mejs-captions-layer mejs-layer"><div class="mejs-captions-position mejs-captions-position-hover" '+h+'><span class="mejs-captions-text"></span></div></div>').prependTo(d).hide(),b.captionsText=b.captions.find(".mejs-captions-text"),b.captionsButton=a('<div class="mejs-button mejs-captions-button"><button type="button" aria-controls="'+g.id+'" title="'+g.options.tracksText+'" aria-label="'+g.options.tracksText+'"></button><div class="mejs-captions-selector"><ul><li><input type="radio" name="'+b.id+'_captions" id="'+b.id+'_captions_none" value="none" checked="checked" /><label for="'+b.id+'_captions_none">'+mejs.i18n.t("None")+"</label></li></ul></div></div>").appendTo(c);var i=0;for(f=0;f<b.tracks.length;f++)"subtitles"==b.tracks[f].kind&&i++;for(g.options.toggleCaptionsButtonWhenOnlyOne&&1==i?b.captionsButton.on("click",function(){null===b.selectedTrack?lang=b.tracks[0].srclang:lang="none",b.setTrack(lang)}):(b.captionsButton.on("mouseenter focusin",function(){a(this).find(".mejs-captions-selector").css("visibility","visible")}).on("click","input[type=radio]",function(){lang=this.value,b.setTrack(lang)}),b.captionsButton.on("mouseleave focusout",function(){a(this).find(".mejs-captions-selector").css("visibility","hidden")})),b.options.alwaysShowControls?b.container.find(".mejs-captions-position").addClass("mejs-captions-position-hover"):b.container.bind("controlsshown",function(){b.container.find(".mejs-captions-position").addClass("mejs-captions-position-hover")}).bind("controlshidden",function(){e.paused||b.container.find(".mejs-captions-position").removeClass("mejs-captions-position-hover")}),b.trackToLoad=-1,b.selectedTrack=null,b.isLoadingTrack=!1,f=0;f<b.tracks.length;f++)"subtitles"==b.tracks[f].kind&&b.addTrackButton(b.tracks[f].srclang,b.tracks[f].label);b.loadNextTrack(),e.addEventListener("timeupdate",function(a){b.displayCaptions()},!1),""!==b.options.slidesSelector&&(b.slidesContainer=a(b.options.slidesSelector),e.addEventListener("timeupdate",function(a){b.displaySlides()},!1)),e.addEventListener("loadedmetadata",function(a){b.displayChapters()},!1),b.container.hover(function(){b.hasChapters&&(b.chapters.css("visibility","visible"),b.chapters.fadeIn(200).height(b.chapters.find(".mejs-chapter").outerHeight()))},function(){b.hasChapters&&!e.paused&&b.chapters.fadeOut(200,function(){a(this).css("visibility","hidden"),a(this).css("display","block")})}),g.container.on("controlsresize",function(){g.adjustLanguageBox()}),null!==b.node.getAttribute("autoplay")&&b.chapters.css("visibility","hidden")}},setTrack:function(a){var b,c=this;if("none"==a)c.selectedTrack=null,c.captionsButton.removeClass("mejs-captions-enabled");else for(b=0;b<c.tracks.length;b++)if(c.tracks[b].srclang==a){null===c.selectedTrack&&c.captionsButton.addClass("mejs-captions-enabled"),c.selectedTrack=c.tracks[b],c.captions.attr("lang",c.selectedTrack.srclang),c.displayCaptions();break}},loadNextTrack:function(){var a=this;a.trackToLoad++,a.trackToLoad<a.tracks.length?(a.isLoadingTrack=!0,a.loadTrack(a.trackToLoad)):(a.isLoadingTrack=!1,a.checkForTracks())},loadTrack:function(b){var c=this,d=c.tracks[b],e=function(){d.isLoaded=!0,c.enableTrackButton(d.srclang,d.label),c.loadNextTrack()};a.ajax({url:d.src,dataType:"text",success:function(a){"string"==typeof a&&/<tt\s+xml/gi.exec(a)?d.entries=mejs.TrackFormatParser.dfxp.parse(a):d.entries=mejs.TrackFormatParser.webvtt.parse(a),e(),"chapters"==d.kind&&c.media.addEventListener("play",function(a){c.media.duration>0&&c.displayChapters(d)},!1),"slides"==d.kind&&c.setupSlides(d)},error:function(){c.removeTrackButton(d.srclang),c.loadNextTrack()}})},enableTrackButton:function(b,c){var d=this;""===c&&(c=mejs.language.codes[b]||b),d.captionsButton.find("input[value="+b+"]").prop("disabled",!1).siblings("label").html(c),d.options.startLanguage==b&&a("#"+d.id+"_captions_"+b).prop("checked",!0).trigger("click"),d.adjustLanguageBox()},removeTrackButton:function(a){var b=this;b.captionsButton.find("input[value="+a+"]").closest("li").remove(),b.adjustLanguageBox()},addTrackButton:function(b,c){var d=this;""===c&&(c=mejs.language.codes[b]||b),d.captionsButton.find("ul").append(a('<li><input type="radio" name="'+d.id+'_captions" id="'+d.id+"_captions_"+b+'" value="'+b+'" disabled="disabled" /><label for="'+d.id+"_captions_"+b+'">'+c+" (loading)</label></li>")),d.adjustLanguageBox(),d.container.find(".mejs-captions-translations option[value="+b+"]").remove()},adjustLanguageBox:function(){var a=this;a.captionsButton.find(".mejs-captions-selector").height(a.captionsButton.find(".mejs-captions-selector ul").outerHeight(!0)+a.captionsButton.find(".mejs-captions-translations").outerHeight(!0))},checkForTracks:function(){var a=this,b=!1;if(a.options.hideCaptionsButtonWhenEmpty){for(i=0;i<a.tracks.length;i++)if("subtitles"==a.tracks[i].kind&&a.tracks[i].isLoaded){b=!0;break}b||(a.captionsButton.hide(),a.setControlsSize())}},displayCaptions:function(){if("undefined"!=typeof this.tracks){var a,b=this,c=b.selectedTrack;if(null!==c&&c.isLoaded){for(a=0;a<c.entries.times.length;a++)if(b.media.currentTime>=c.entries.times[a].start&&b.media.currentTime<=c.entries.times[a].stop)return b.captionsText.html(c.entries.text[a]).attr("class","mejs-captions-text "+(c.entries.times[a].identifier||"")),void b.captions.show().height(0);b.captions.hide()}else b.captions.hide()}},setupSlides:function(a){var b=this;b.slides=a,b.slides.entries.imgs=[b.slides.entries.text.length],b.showSlide(0)},showSlide:function(b){if("undefined"!=typeof this.tracks&&"undefined"!=typeof this.slidesContainer){var c=this,d=c.slides.entries.text[b],e=c.slides.entries.imgs[b];"undefined"==typeof e||"undefined"==typeof e.fadeIn?c.slides.entries.imgs[b]=e=a('<img src="'+d+'">').on("load",function(){e.appendTo(c.slidesContainer).hide().fadeIn().siblings(":visible").fadeOut()}):e.is(":visible")||e.is(":animated")||e.fadeIn().siblings(":visible").fadeOut()}},displaySlides:function(){if("undefined"!=typeof this.slides){var a,b=this,c=b.slides;for(a=0;a<c.entries.times.length;a++)if(b.media.currentTime>=c.entries.times[a].start&&b.media.currentTime<=c.entries.times[a].stop)return void b.showSlide(a)}},displayChapters:function(){var a,b=this;for(a=0;a<b.tracks.length;a++)if("chapters"==b.tracks[a].kind&&b.tracks[a].isLoaded){b.drawChapters(b.tracks[a]),b.hasChapters=!0;break}},drawChapters:function(b){var c,d,e=this,f=0,g=0;for(e.chapters.empty(),c=0;c<b.entries.times.length;c++)d=b.entries.times[c].stop-b.entries.times[c].start,f=Math.floor(d/e.media.duration*100),(f+g>100||c==b.entries.times.length-1&&100>f+g)&&(f=100-g),e.chapters.append(a('<div class="mejs-chapter" rel="'+b.entries.times[c].start+'" style="left: '+g.toString()+"%;width: "+f.toString()+'%;"><div class="mejs-chapter-block'+(c==b.entries.times.length-1?" mejs-chapter-block-last":"")+'"><span class="ch-title">'+b.entries.text[c]+'</span><span class="ch-time">'+mejs.Utility.secondsToTimeCode(b.entries.times[c].start,e.options)+"&ndash;"+mejs.Utility.secondsToTimeCode(b.entries.times[c].stop,e.options)+"</span></div></div>")),g+=f;e.chapters.find("div.mejs-chapter").click(function(){e.media.setCurrentTime(parseFloat(a(this).attr("rel"))),e.media.paused&&e.media.play()}),e.chapters.show()}}),mejs.language={codes:{af:"Afrikaans",sq:"Albanian",ar:"Arabic",be:"Belarusian",bg:"Bulgarian",ca:"Catalan",zh:"Chinese","zh-cn":"Chinese Simplified","zh-tw":"Chinese Traditional",hr:"Croatian",cs:"Czech",da:"Danish",nl:"Dutch",en:"English",et:"Estonian",fl:"Filipino",fi:"Finnish",fr:"French",gl:"Galician",de:"German",el:"Greek",ht:"Haitian Creole",iw:"Hebrew",hi:"Hindi",hu:"Hungarian",is:"Icelandic",id:"Indonesian",ga:"Irish",it:"Italian",ja:"Japanese",ko:"Korean",lv:"Latvian",lt:"Lithuanian",mk:"Macedonian",ms:"Malay",mt:"Maltese",no:"Norwegian",fa:"Persian",pl:"Polish",pt:"Portuguese",ro:"Romanian",ru:"Russian",sr:"Serbian",sk:"Slovak",sl:"Slovenian",es:"Spanish",sw:"Swahili",sv:"Swedish",tl:"Tagalog",th:"Thai",tr:"Turkish",uk:"Ukrainian",vi:"Vietnamese",cy:"Welsh",yi:"Yiddish"}},mejs.TrackFormatParser={webvtt:{pattern_timecode:/^((?:[0-9]{1,2}:)?[0-9]{2}:[0-9]{2}([,.][0-9]{1,3})?) --\> ((?:[0-9]{1,2}:)?[0-9]{2}:[0-9]{2}([,.][0-9]{3})?)(.*)$/,parse:function(b){for(var c,d,e,f=0,g=mejs.TrackFormatParser.split2(b,/\r?\n/),h={text:[],times:[]};f<g.length;f++){if(c=this.pattern_timecode.exec(g[f]),c&&f<g.length){for(f-1>=0&&""!==g[f-1]&&(e=g[f-1]),f++,d=g[f],f++;""!==g[f]&&f<g.length;)d=d+"\n"+g[f],f++;d=a.trim(d).replace(/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gi,"<a href='$1' target='_blank'>$1</a>"),h.text.push(d),h.times.push({identifier:e,start:0===mejs.Utility.convertSMPTEtoSeconds(c[1])?.2:mejs.Utility.convertSMPTEtoSeconds(c[1]),stop:mejs.Utility.convertSMPTEtoSeconds(c[3]),settings:c[5]})}e=""}return h}},dfxp:{parse:function(b){b=a(b).filter("tt");var c,d,e=0,f=b.children("div").eq(0),g=f.find("p"),h=b.find("#"+f.attr("style")),i={text:[],times:[]};if(h.length){var j=h.removeAttr("id").get(0).attributes;if(j.length)for(c={},e=0;e<j.length;e++)c[j[e].name.split(":")[1]]=j[e].value}for(e=0;e<g.length;e++){var k,l={start:null,stop:null,style:null};if(g.eq(e).attr("begin")&&(l.start=mejs.Utility.convertSMPTEtoSeconds(g.eq(e).attr("begin"))),!l.start&&g.eq(e-1).attr("end")&&(l.start=mejs.Utility.convertSMPTEtoSeconds(g.eq(e-1).attr("end"))),g.eq(e).attr("end")&&(l.stop=mejs.Utility.convertSMPTEtoSeconds(g.eq(e).attr("end"))),!l.stop&&g.eq(e+1).attr("begin")&&(l.stop=mejs.Utility.convertSMPTEtoSeconds(g.eq(e+1).attr("begin"))),c){k="";for(var m in c)k+=m+":"+c[m]+";"}k&&(l.style=k),0===l.start&&(l.start=.2),i.times.push(l),d=a.trim(g.eq(e).html()).replace(/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gi,"<a href='$1' target='_blank'>$1</a>"),i.text.push(d),0===i.times.start&&(i.times.start=2)}return i}},split2:function(a,b){return a.split(b)}},3!="x\n\ny".split(/\n/gi).length&&(mejs.TrackFormatParser.split2=function(a,b){var c,d=[],e="";for(c=0;c<a.length;c++)e+=a.substring(c,c+1),b.test(e)&&(d.push(e.replace(b,"")),e="");return d.push(e),d})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{contextMenuItems:[{render:function(a){return"undefined"==typeof a.enterFullScreen?null:a.isFullScreen?mejs.i18n.t("Turn off Fullscreen"):mejs.i18n.t("Go Fullscreen")},click:function(a){a.isFullScreen?a.exitFullScreen():a.enterFullScreen()}},{render:function(a){return a.media.muted?mejs.i18n.t("Unmute"):mejs.i18n.t("Mute")},click:function(a){a.media.muted?a.setMuted(!1):a.setMuted(!0)}},{isSeparator:!0},{render:function(a){return mejs.i18n.t("Download Video")},click:function(a){window.location.href=a.media.currentSrc}}]}),a.extend(MediaElementPlayer.prototype,{buildcontextmenu:function(b,c,d,e){b.contextMenu=a('<div class="mejs-contextmenu"></div>').appendTo(a("body")).hide(),b.container.bind("contextmenu",function(a){return b.isContextMenuEnabled?(a.preventDefault(),b.renderContextMenu(a.clientX-1,a.clientY-1),!1):void 0}),b.container.bind("click",function(){b.contextMenu.hide()}),b.contextMenu.bind("mouseleave",function(){b.startContextMenuTimer()})},cleancontextmenu:function(a){a.contextMenu.remove()},isContextMenuEnabled:!0,enableContextMenu:function(){this.isContextMenuEnabled=!0},disableContextMenu:function(){this.isContextMenuEnabled=!1},contextMenuTimeout:null,startContextMenuTimer:function(){var a=this;a.killContextMenuTimer(),a.contextMenuTimer=setTimeout(function(){a.hideContextMenu(),a.killContextMenuTimer()},750)},killContextMenuTimer:function(){var a=this.contextMenuTimer;null!=a&&(clearTimeout(a),delete a,a=null)},hideContextMenu:function(){this.contextMenu.hide()},renderContextMenu:function(b,c){for(var d=this,e="",f=d.options.contextMenuItems,g=0,h=f.length;h>g;g++)if(f[g].isSeparator)e+='<div class="mejs-contextmenu-separator"></div>';else{var i=f[g].render(d);null!=i&&(e+='<div class="mejs-contextmenu-item" data-itemindex="'+g+'" id="element-'+1e6*Math.random()+'">'+i+"</div>")}d.contextMenu.empty().append(a(e)).css({top:c,left:b}).show(),d.contextMenu.find(".mejs-contextmenu-item").each(function(){var b=a(this),c=parseInt(b.data("itemindex"),10),e=d.options.contextMenuItems[c];"undefined"!=typeof e.show&&e.show(b,d),b.click(function(){"undefined"!=typeof e.click&&e.click(d),d.contextMenu.hide()})}),setTimeout(function(){d.killControlsTimer("rev3")},100)}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{skipBackInterval:30,skipBackText:mejs.i18n.t("Skip back %1 seconds")}),a.extend(MediaElementPlayer.prototype,{buildskipback:function(b,c,d,e){var f=this,g=f.options.skipBackText.replace("%1",f.options.skipBackInterval);a('<div class="mejs-button mejs-skip-back-button"><button type="button" aria-controls="'+f.id+'" title="'+g+'" aria-label="'+g+'">'+f.options.skipBackInterval+"</button></div>").appendTo(c).click(function(){e.setCurrentTime(Math.max(e.currentTime-f.options.skipBackInterval,0)),a(this).find("button").blur()})}})}(mejs.$),function(a){a.extend(mejs.MepDefaults,{postrollCloseText:mejs.i18n.t("Close")}),a.extend(MediaElementPlayer.prototype,{buildpostroll:function(b,c,d,e){var f=this,g=f.container.find('link[rel="postroll"]').attr("href");"undefined"!=typeof g&&(b.postroll=a('<div class="mejs-postroll-layer mejs-layer"><a class="mejs-postroll-close" onclick="$(this).parent().hide();return false;">'+f.options.postrollCloseText+'</a><div class="mejs-postroll-layer-content"></div></div>').prependTo(d).hide(),f.media.addEventListener("ended",function(c){a.ajax({dataType:"html",url:g,success:function(a,b){d.find(".mejs-postroll-layer-content").html(a)}}),b.postroll.show()},!1))}})}(mejs.$);
define("components/adapt-contrib-media/js/mediaelement-and-player.min", function(){});

define('components/adapt-contrib-media/js/adapt-contrib-media',['require','components/adapt-contrib-media/js/mediaelement-and-player.min','coreViews/componentView','coreJS/adapt'],function(require) {

    var mep = require('components/adapt-contrib-media/js/mediaelement-and-player.min');
    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var froogaloopAdded = false;

    var Media = ComponentView.extend({

        events: {
            "click .media-inline-transcript-button": "onToggleInlineTranscript"
        },

        preRender: function() {
            this.listenTo(Adapt, 'device:resize', this.onScreenSizeChanged);
            this.listenTo(Adapt, 'device:changed', this.onDeviceChanged);
            this.listenTo(Adapt, 'accessibility:toggle', this.onAccessibilityToggle);

            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.setupPlayer();
        },


        setupPlayer: function() {
            if (!this.model.get('_playerOptions')) this.model.set('_playerOptions', {});

            var modelOptions = this.model.get('_playerOptions');

            if (modelOptions.pluginPath === undefined) modelOptions.pluginPath = 'assets/';
            if(modelOptions.features === undefined) {
                modelOptions.features = ['playpause','progress','current','duration'];
                if (this.model.get('_useClosedCaptions')) {
                    modelOptions.features = ['playpause','progress','tracks','current','duration'];
                }
            }

            modelOptions.success = _.bind(this.onPlayerReady, this);

            if (this.model.get('_useClosedCaptions')) {
                modelOptions.startLanguage = this.model.get('_startLanguage') === undefined ? 'en' : this.model.get('_startLanguage');
            }

            var hasAccessibility = Adapt.config.has('_accessibility') && Adapt.config.get('_accessibility')._isActive
                ? true
                : false;

            if (hasAccessibility) {
                modelOptions.alwaysShowControls = true;
                modelOptions.hideVideoControlsOnLoad = false;
            }
            
            if (modelOptions.alwaysShowControls === undefined) {
                modelOptions.alwaysShowControls = false;
            }
            if (modelOptions.hideVideoControlsOnLoad === undefined) {
                modelOptions.hideVideoControlsOnLoad = true;
            }

            this.addMediaTypeClass();

            this.addThirdPartyFixes(modelOptions, _.bind(function createPlayer() {
                // create the player
                this.$('audio, video').mediaelementplayer(modelOptions);

                // We're streaming - set ready now, as success won't be called above
                if (this.model.get('_media').source) {
                    this.$('.media-widget').addClass('external-source');
                    this.setReadyStatus();
                }
            }, this));
        },

        addMediaTypeClass: function() {
            var media = this.model.get("_media");
            if (media.type) {
                var typeClass = media.type.replace(/\//, "-");
                this.$(".media-widget").addClass(typeClass);
            }
        },

        addThirdPartyFixes: function(modelOptions, callback) {
            var media = this.model.get("_media");
            switch (media.type) {
            case "video/vimeo":
                modelOptions.alwaysShowControls = false;
                modelOptions.hideVideoControlsOnLoad = true;
                modelOptions.features = [];
                if (froogaloopAdded) return callback();
                Modernizr.load({
                    load: "assets/froogaloop.js", 
                    complete: function() {
                        froogaloopAdded = true;
                        callback();
                    }
                }); 
                break;
            default:
                callback();
            }
        },

        setupEventListeners: function() {
            this.completionEvent = (!this.model.get('_setCompletionOn')) ? 'play' : this.model.get('_setCompletionOn');

            if (this.completionEvent !== 'inview') {
                this.mediaElement.addEventListener(this.completionEvent, _.bind(this.onCompletion, this));
            } else {
                this.$('.component-widget').on('inview', _.bind(this.inview, this));
            }
        },

        // Overrides the default play/pause functionality to stop accidental playing on touch devices
        setupPlayPauseToggle: function() {
            // bit sneaky, but we don't have a this.mediaElement.player ref on iOS devices
            var player = this.mediaElement.player;

            if (!player) {
                console.log("Media.setupPlayPauseToggle: OOPS! there's no player reference.");
                return;
            }

            // stop the player dealing with this, we'll do it ourselves
            player.options.clickToPlayPause = false;

            // play on 'big button' click
            $('.mejs-overlay-button',this.$el).click(_.bind(function(event) {
                player.play();
            }, this));

            // pause on player click
            $('.mejs-mediaelement',this.$el).click(_.bind(function(event) {
                var isPaused = player.media.paused;
                if(!isPaused) player.pause();
            }, this));
        },

        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$('.component-inner').off('inview');
                    this.setCompletionStatus();
                }
            }
        },

        remove: function() {
            if ($("html").is(".ie8")) {
                var obj = this.$("object")[0];
                if (obj) {
                    obj.style.display = "none";
                }
            }
            if (this.mediaElement) {
                $(this.mediaElement.pluginElement).remove();
                delete this.mediaElement;
            }
            ComponentView.prototype.remove.call(this);
        },

        onCompletion: function() {
            this.setCompletionStatus();

            // removeEventListener needs to pass in the method to remove the event in firefox and IE10
            this.mediaElement.removeEventListener(this.completionEvent, this.onCompletion);
        },

        onDeviceChanged: function() {
            if (this.model.get('_media').source) {
                this.$('.mejs-container').width(this.$('.component-widget').width());
            }
        },

        onPlayerReady: function (mediaElement, domObject) {
            this.mediaElement = mediaElement;

            if (!this.mediaElement.player) {
                this.mediaElement.player =  mejs.players[this.$('.mejs-container').attr('id')];
            }

            var hasTouch = mejs.MediaFeatures.hasTouch;
            if (hasTouch) {
                this.setupPlayPauseToggle();
            }

            this.setReadyStatus();
            this.setupEventListeners();
        },

        onScreenSizeChanged: function() {
            this.$('audio, video').width(this.$('.component-widget').width());
        },

        onAccessibilityToggle: function() {
           this.showControls();
        },

        onToggleInlineTranscript: function(event) {
            if (event) event.preventDefault();
            var $transcriptBodyContainer = this.$(".media-inline-transcript-body-container");
            var $button = this.$(".media-inline-transcript-button");

            if ($transcriptBodyContainer.hasClass("inline-transcript-open")) {
                $transcriptBodyContainer.slideUp();
                $transcriptBodyContainer.removeClass("inline-transcript-open");
                $button.html(this.model.get("_transcript").inlineTranscriptButton);
            } else {
                $transcriptBodyContainer.slideDown().a11y_focus();
                $transcriptBodyContainer.addClass("inline-transcript-open");
                $button.html(this.model.get("_transcript").inlineTranscriptCloseButton);
                if (Adapt.config.get('_accessibility')._isActive || this.model.get('_transcript')._setCompletionOnView) {
                    this.setCompletionStatus();
                }
            }
        },

        showControls: function() {
            var hasAccessibility = Adapt.config.has('_accessibility') && Adapt.config.get('_accessibility')._isActive
                ? true
                : false;

            if (hasAccessibility) {
                if (!this.mediaElement.player) return;

                var player = this.mediaElement.player;

                player.options.alwaysShowControls = true;
                player.options.hideVideoControlsOnLoad = false;
                player.enableControls();
                player.showControls();

                this.$('.mejs-playpause-button button').attr({
                    "role": "button"
                });
                var screenReaderVideoTagFix = $("<div role='region' aria-label='.'>");
                this.$('.mejs-playpause-button').prepend(screenReaderVideoTagFix);

                this.$('.mejs-time, .mejs-time-rail').attr({
                    "aria-hidden": "true"
                });
            }
        }
    });

    Adapt.register('media', Media);

    return Media;

});

define('components/adapt-contrib-narrative/js/adapt-contrib-narrative',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var Narrative = ComponentView.extend({

        events: {
            'click .narrative-strapline-title': 'openPopup',
            'click .narrative-controls': 'onNavigationClicked',
            'click .narrative-indicators .narrative-progress': 'onProgressClicked'
        },

        preRender: function() {
            this.listenTo(Adapt, 'device:changed', this.reRender, this);
            this.listenTo(Adapt, 'device:resize', this.resizeControl, this);
            this.listenTo(Adapt, 'notify:closed', this.closeNotify, this);
            this.setDeviceSize();

            // Checks to see if the narrative should be reset on revisit
            this.checkIfResetOnRevisit();
        },

        setDeviceSize: function() {
            if (Adapt.device.screenSize === 'large') {
                this.$el.addClass('desktop').removeClass('mobile');
                this.model.set('_isDesktop', true);
            } else {
                this.$el.addClass('mobile').removeClass('desktop');
                this.model.set('_isDesktop', false)
            }
        },

        postRender: function() {
            this.renderState();
            this.$('.narrative-slider').imageready(_.bind(function() {
                this.setReadyStatus();
            }, this));
            this.setupNarrative();
        },

        // Used to check if the narrative should reset on revisit
        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
                this.model.set({_stage: 0});

                _.each(this.model.get('_items'), function(item) {
                    item.visited = false;
                });
            }
        },

        setupNarrative: function() {
            this.setDeviceSize();
            this.model.set('_marginDir', 'left');
            if (Adapt.config.get('_defaultDirection') == 'rtl') {
                this.model.set('_marginDir', 'right');
            }
            this.model.set('_itemCount', this.model.get('_items').length);

            this.model.set('_active', true);

            if (this.model.get('_stage')) {
                this.setStage(this.model.get('_stage'), true);
            } else {
                this.setStage(0, true);
            }
            this.calculateWidths();

            if (Adapt.device.screenSize !== 'large' && !this.model.get('_wasHotgraphic')) {
                this.replaceInstructions();
            }
            this.setupEventListeners();
            
            // if hasNavigationInTextArea set margin left 
            var hasNavigationInTextArea = this.model.get('_hasNavigationInTextArea');
            if (hasNavigationInTextArea == true) {
                var indicatorWidth = this.$('.narrative-indicators').width();
                var marginLeft = indicatorWidth / 2;
                
                this.$('.narrative-indicators').css({
                    marginLeft: '-' + marginLeft + 'px'
                });
            }
        },

        calculateWidths: function() {
            var slideWidth = this.$('.narrative-slide-container').width();
            var slideCount = this.model.get('_itemCount');
            var marginRight = this.$('.narrative-slider-graphic').css('margin-right');
            var extraMargin = marginRight === '' ? 0 : parseInt(marginRight);
            var fullSlideWidth = (slideWidth + extraMargin) * slideCount;
            var iconWidth = this.$('.narrative-popup-open').outerWidth();

            this.$('.narrative-slider-graphic').width(slideWidth);
            this.$('.narrative-strapline-header').width(slideWidth);
            this.$('.narrative-strapline-title').width(slideWidth);

            this.$('.narrative-slider').width(fullSlideWidth);
            this.$('.narrative-strapline-header-inner').width(fullSlideWidth);

            var stage = this.model.get('_stage');
            var margin = -(stage * slideWidth);

            this.$('.narrative-slider').css(('margin-' + this.model.get('_marginDir')), margin);
            this.$('.narrative-strapline-header-inner').css(('margin-' + this.model.get('_marginDir')), margin);

            this.model.set('_finalItemLeft', fullSlideWidth - slideWidth);
        },

        resizeControl: function() {
            this.setDeviceSize();
            this.replaceInstructions();
            this.calculateWidths();
            this.evaluateNavigation();
        },

        reRender: function() {
            if (this.model.get('_wasHotgraphic') && Adapt.device.screenSize == 'large') {
                this.replaceWithHotgraphic();
            } else {
                this.resizeControl();
            }
        },

        closeNotify: function() {
            this.evaluateCompletion()
        },

        replaceInstructions: function() {
            if (Adapt.device.screenSize === 'large') {
                this.$('.narrative-instruction-inner').html(this.model.get('instruction')).a11y_text();
            } else if (this.model.get('mobileInstruction') && !this.model.get('_wasHotgraphic')) {
                this.$('.narrative-instruction-inner').html(this.model.get('mobileInstruction')).a11y_text();
            }
        },

        replaceWithHotgraphic: function() {
            if (!Adapt.componentStore.hotgraphic) throw "Hotgraphic not included in build";
            var Hotgraphic = Adapt.componentStore.hotgraphic;
            
            var model = this.prepareHotgraphicModel();
            var newHotgraphic = new Hotgraphic({ model: model });
            var $container = $(".component-container", $("." + this.model.get("_parentId")));

            $container.append(newHotgraphic.$el);
            this.remove();
            _.defer(function() {
                Adapt.trigger('device:resize');
            });
        },

        prepareHotgraphicModel: function() {
            var model = this.model;
            model.set('_component', 'hotgraphic');
            model.set('body', model.get('originalBody'));
            model.set('instruction', model.get('originalInstruction'));
            return model;
        },

        moveSliderToIndex: function(itemIndex, animate, callback) {
            var extraMargin = parseInt(this.$('.narrative-slider-graphic').css('margin-right'));
            var movementSize = this.$('.narrative-slide-container').width() + extraMargin;
            var marginDir = {};
            if (animate && !Adapt.config.get('_disableAnimation')) {
                marginDir['margin-' + this.model.get('_marginDir')] = -(movementSize * itemIndex);
                this.$('.narrative-slider').velocity("stop", true).velocity(marginDir);
                this.$('.narrative-strapline-header-inner').velocity("stop", true).velocity(marginDir, {complete:callback});
            } else {
                marginDir['margin-' + this.model.get('_marginDir')] = -(movementSize * itemIndex);
                this.$('.narrative-slider').css(marginDir);
                this.$('.narrative-strapline-header-inner').css(marginDir);
                callback();
            }
        },

        setStage: function(stage, initial) {
            this.model.set('_stage', stage);

            if (this.model.get('_isDesktop')) {
                // Set the visited attribute for large screen devices
                var currentItem = this.getCurrentItem(stage);
                currentItem.visited = true;
            }

            this.$('.narrative-progress:visible').removeClass('selected').eq(stage).addClass('selected');
            this.$('.narrative-slider-graphic').children('.controls').a11y_cntrl_enabled(false);
            this.$('.narrative-slider-graphic').eq(stage).children('.controls').a11y_cntrl_enabled(true);
            this.$('.narrative-content-item').addClass('narrative-hidden').a11y_on(false).eq(stage).removeClass('narrative-hidden').a11y_on(true);
            this.$('.narrative-strapline-title').a11y_cntrl_enabled(false).eq(stage).a11y_cntrl_enabled(true);

            this.evaluateNavigation();
            this.evaluateCompletion();

            this.moveSliderToIndex(stage, !initial, _.bind(function() {
                if (this.model.get('_isDesktop')) {
                    if (!initial) this.$('.narrative-content-item').eq(stage).a11y_focus();
                } else {
                    if (!initial) this.$('.narrative-popup-open').a11y_focus();
                }
            }, this));
        },

        constrainStage: function(stage) {
            if (stage > this.model.get('_items').length - 1) {
                stage = this.model.get('_items').length - 1;
            } else if (stage < 0) {
                stage = 0;
            }
            return stage;
        },

        constrainXPosition: function(previousLeft, newLeft, deltaX) {
            if (newLeft > 0 && deltaX > 0) {
                newLeft = previousLeft + (deltaX / (newLeft * 0.1));
            }
            var finalItemLeft = this.model.get('_finalItemLeft');
            if (newLeft < -finalItemLeft && deltaX < 0) {
                var distance = Math.abs(newLeft + finalItemLeft);
                newLeft = previousLeft + (deltaX / (distance * 0.1));
            }
            return newLeft;
        },

        evaluateNavigation: function() {
            var currentStage = this.model.get('_stage');
            var itemCount = this.model.get('_itemCount');
            if (currentStage == 0) {
                this.$('.narrative-control-left').addClass('narrative-hidden');

                if (itemCount > 1) {
                    this.$('.narrative-control-right').removeClass('narrative-hidden');
                }
            } else {
                this.$('.narrative-control-left').removeClass('narrative-hidden');

                if (currentStage == itemCount - 1) {
                    this.$('.narrative-control-right').addClass('narrative-hidden');
                } else {
                    this.$('.narrative-control-right').removeClass('narrative-hidden');
                }
            }

        },

        getNearestItemIndex: function() {
            var currentPosition = parseInt(this.$('.narrative-slider').css('margin-left'));
            var graphicWidth = this.$('.narrative-slider-graphic').width();
            var absolutePosition = currentPosition / graphicWidth;
            var stage = this.model.get('_stage');
            var relativePosition = stage - Math.abs(absolutePosition);

            if (relativePosition < -0.3) {
                stage++;
            } else if (relativePosition > 0.3) {
                stage--;
            }

            return this.constrainStage(stage);
        },

        getCurrentItem: function(index) {
            return this.model.get('_items')[index];
        },

        getVisitedItems: function() {
            return _.filter(this.model.get('_items'), function(item) {
                return item.visited;
            });
        },

        evaluateCompletion: function() {
            if (this.getVisitedItems().length === this.model.get('_items').length) {
                this.trigger('allItems');
            } 
        },

        moveElement: function($element, deltaX) {
            var previousLeft = parseInt($element.css('margin-left'));
            var newLeft = previousLeft + deltaX;

            newLeft = this.constrainXPosition(previousLeft, newLeft, deltaX);
            $element.css(('margin-' + this.model.get('_marginDir')), newLeft + 'px');
        },

        openPopup: function(event) {
            event.preventDefault();
            var currentItem = this.getCurrentItem(this.model.get('_stage'));
            var popupObject = {
                title: currentItem.title,
                body: currentItem.body
            };

            // Set the visited attribute for small and medium screen devices
            currentItem.visited = true;

            Adapt.trigger('notify:popup', popupObject);
        },

        onNavigationClicked: function(event) {
            event.preventDefault();

            if (!this.model.get('_active')) return;

            var stage = this.model.get('_stage');
            var numberOfItems = this.model.get('_itemCount');

            if ($(event.currentTarget).hasClass('narrative-control-right')) {
                stage++;
            } else if ($(event.currentTarget).hasClass('narrative-control-left')) {
                stage--;
            }
            stage = (stage + numberOfItems) % numberOfItems;
            this.setStage(stage);
        },
        
        onProgressClicked: function(event) {
            event.preventDefault();
            var clickedIndex = $(event.target).index();
            this.setStage(clickedIndex);
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$('.component-inner').off('inview');
                    this.setCompletionStatus();
                }
            }
        },

        onCompletion: function() {
            this.setCompletionStatus();
            if (this.completionEvent && this.completionEvent != 'inview') {
                this.off(this.completionEvent, this);
            }
        },

        setupEventListeners: function() {
            this.completionEvent = (!this.model.get('_setCompletionOn')) ? 'allItems' : this.model.get('_setCompletionOn');
            if (this.completionEvent !== 'inview') {
                this.on(this.completionEvent, _.bind(this.onCompletion, this));
            } else {
                this.$('.component-widget').on('inview', _.bind(this.inview, this));
            }
        }

    });

    Adapt.register('narrative', Narrative);

    return Narrative;

});

define('components/adapt-contrib-slider/js/adapt-contrib-slider',['require','coreViews/questionView','coreJS/adapt'],function(require) {
    var QuestionView = require('coreViews/questionView');
    var Adapt = require('coreJS/adapt');

    var Slider = QuestionView.extend({

        events: {
            'click .slider-sliderange': 'onSliderSelected',
            'click .slider-handle': 'preventEvent',
            'click .slider-scale-number': 'onNumberSelected',
            'touchstart .slider-handle':'onHandlePressed',
            'mousedown .slider-handle': 'onHandlePressed',
            'focus .slider-handle':'onHandleFocus',
            'blur .slider-handle':'onHandleBlur'
        },

        // Used by the question to reset the question when revisiting the component
        resetQuestionOnRevisit: function() {
            this.setAllItemsEnabled(true);
            this.deselectAllItems();
            this.resetQuestion();
        },

        // Used by question to setup itself just before rendering
        setupQuestion: function() {
            if(!this.model.get('_items')) {
                this.setupModelItems();
            }

            this.model.set({
                _selectedItem: {}
            });

            this.restoreUserAnswers();
            if (this.model.get('_isSubmitted')) return;

            this.selectItem(0);
        },

        setupModelItems: function() {
            var items = [];
            var answer = this.model.get('_correctAnswer');
            var range = this.model.get('_correctRange');
            var start = this.model.get('_scaleStart');
            var end = this.model.get('_scaleEnd');

            for (var i = start; i <= end; i++) {
                if (answer) {
                    items.push({value: i, selected: false, correct: (i == answer)});
                } else {
                    items.push({value: i, selected: false, correct: (i >= range._bottom && i <= range._top)});
                }
            }

            this.model.set('_items', items);
        },

        restoreUserAnswers: function() {
            if (!this.model.get('_isSubmitted')) return;

            var items = this.model.get('_items');
            var userAnswer = this.model.get('_userAnswer');
            for (var i = 0, l = items.length; i < l; i++) {
                var item = items[i];
                if (item.value == userAnswer) {
                    this.model.set('_selectedItem', item);
                    this.selectItem(this.getIndexFromValue(item.value));
                    break;
                }
            }

            this.setQuestionAsSubmitted();
            this.markQuestion();
            this.setScore();
            this.showMarking();
            this.setupFeedback();
        },

        // Used by question to disable the question during submit and complete stages
        disableQuestion: function() {
            this.setAllItemsEnabled(false);
        },

        // Used by question to enable the question during interactions
        enableQuestion: function() {
            this.setAllItemsEnabled(true);
        },

        setAllItemsEnabled: function(isEnabled) {
            if (isEnabled) {
                this.$('.slider-widget').removeClass('disabled');
            } else {
                this.$('.slider-widget').addClass('disabled');
            }
        },

        // Used by question to setup itself just after rendering
        onQuestionRendered: function() {
            this.setScalePositions();
            this.onScreenSizeChanged();
            this.showScaleMarker(true);
            this.listenTo(Adapt, 'device:resize', this.onScreenSizeChanged);
            this.setAltText(this.model.get('_scaleStart'));
            this.setReadyStatus();
        },

        // this should make the slider handle, slider marker and slider bar to animate to give position
        animateToPosition: function(newPosition) {
            this.$('.slider-handle').stop(true).animate({
                left: newPosition + 'px'
            },200);
            this.$('.slider-bar').stop(true).animate({width:newPosition + 'px'});
            this.$('.slider-scale-marker').stop(true).animate({
                left: newPosition + 'px'
            },200);
            this.$('.slider-bar').stop(true).animate({width:newPosition + 'px'});
        },

        // this shoud give the index of item using given slider value
        getIndexFromValue: function(itemValue) {
            var scaleStart = this.model.get('_scaleStart'),
                scaleEnd = this.model.get('_scaleEnd');
            return Math.floor(this.mapValue(itemValue, scaleStart, scaleEnd, 0, this.model.get('_items').length - 1));
        },

        // this should set given value to slider handle
        setAltText: function(value) {
            this.$('.slider-handle').attr('aria-valuenow', value);
        },

        mapIndexToPixels: function(value, $widthObject) {
            var numberOfItems = this.model.get('_items').length,
                width = $widthObject ? $widthObject.width() : this.$('.slider-sliderange').width();

            return Math.round(this.mapValue(value, 0, numberOfItems - 1, 0, width));
        },

        mapPixelsToIndex: function(value) {
            var numberOfItems = this.model.get('_items').length,
                width = this.$('.slider-sliderange').width();

            return Math.round(this.mapValue(value, 0, width, 0, numberOfItems - 1));
        },

        normalise: function(value, low, high) {
            var range = high - low;
            return (value - low) / range;
        },

        mapValue: function(value, inputLow, inputHigh, outputLow, outputHigh) {
            var normal = this.normalise(value, inputLow, inputHigh);
            return normal * (outputHigh - outputLow) + outputLow;
        },

        onDragReleased: function (event) {
            event.preventDefault();

            if (Modernizr.touch) {
                this.$('.slider-handle').off('touchmove');
            } else {
                $(document).off('mousemove.adapt-contrib-slider');
            }

            var itemValue = this.model.get('_selectedItem').value;
            var itemIndex = this.getIndexFromValue(itemValue);
            this.animateToPosition(this.mapIndexToPixels(itemIndex));
            this.setAltText(itemValue);
        },

        onHandleDragged: function (event) {
            event.preventDefault();
            var left = (event.pageX || event.originalEvent.touches[0].pageX) - event.data.offsetLeft;
            left = Math.max(Math.min(left, event.data.width), 0);

            this.$('.slider-handle').css({
                left: left + 'px'
            });

            this.$('.slider-scale-marker').css({
                left: left + 'px'
            });

            this.selectItem(this.mapPixelsToIndex(left));
        },

        onHandleFocus: function(event) {
            event.preventDefault();
            this.$('.slider-handle').on('keydown', _.bind(this.onKeyDown, this));
        },

        onHandleBlur: function(event) {
            event.preventDefault();
            this.$('.slider-handle').off('keydown');
        },

        onHandlePressed: function (event) {
            event.preventDefault();
            if (!this.model.get('_isEnabled') || this.model.get('_isSubmitted')) return;

            this.showScaleMarker(true);

            var eventData = {
                width:this.$('.slider-sliderange').width(),
                offsetLeft: this.$('.slider-sliderange').offset().left
            };

            if(Modernizr.touch) {
                this.$('.slider-handle').on('touchmove', eventData, _.bind(this.onHandleDragged, this));
                this.$('.slider-handle').one('touchend', eventData, _.bind(this.onDragReleased, this));
            } else {
                $(document).on('mousemove.adapt-contrib-slider', eventData, _.bind(this.onHandleDragged, this));
                $(document).one('mouseup', eventData, _.bind(this.onDragReleased, this));
            }
        },

        onKeyDown: function(event) {
            if(event.which == 9) return; // tab key
            event.preventDefault();

            var newItemIndex = this.getIndexFromValue(this.model.get('_selectedItem').value);

            switch (event.which) {
                case 40: // ↓ down
                case 37: // ← left
                    newItemIndex = Math.max(newItemIndex - 1, 0);
                    break;
                case 38: // ↑ up
                case 39: // → right
                    newItemIndex = Math.min(newItemIndex + 1, this.model.get('_items').length - 1);
                    break;
            }

            this.selectItem(newItemIndex);
            if(typeof newItemIndex == 'number') this.showScaleMarker(true);
            this.animateToPosition(this.mapIndexToPixels(newItemIndex));
            this.setAltText(this.getValueFromIndex(newItemIndex));
        },

        onSliderSelected: function (event) {
            event.preventDefault();

            if (!this.model.get('_isEnabled') || this.model.get('_isSubmitted')) {
              return;
            }

            this.showScaleMarker(true);

            var offsetLeft = this.$('.slider-sliderange').offset().left;
            var width = this.$('.slider-sliderange').width();
            var left = (event.pageX || event.originalEvent.touches[0].pageX) - offsetLeft;

            left = Math.max(Math.min(left, width), 0);
            var itemIndex = this.mapPixelsToIndex(left);
            this.selectItem(itemIndex);
            this.animateToPosition(this.mapIndexToPixels(itemIndex));
            this.setAltText(this.getValueFromIndex(itemIndex));
        },

        onNumberSelected: function(event) {
            event.preventDefault();

            if (this.model.get('_isComplete')) {
              return;
            }

            var itemValue = parseInt($(event.currentTarget).attr('data-id'));
            var index = this.getIndexFromValue(itemValue);
            var $scaler = this.$('.slider-scaler');
            this.selectItem(index);
            this.animateToPosition(this.mapIndexToPixels(index, $scaler));
            this.setAltText(itemValue);
        },

        getValueFromIndex: function(index) {
          return this.model.get('_items')[index].value;
        },

        preventEvent: function(event) {
            event.preventDefault();
        },

        resetControlStyles: function() {
            this.$('.slider-handle').empty();
            this.showScaleMarker(false);
            this.$('.slider-bar').animate({width:'0px'});
        },

        /**
        * allow the user to submit immediately; the slider handle may already be in the position they want to choose
        */
        canSubmit: function() {
            return true;
        },

        // Blank method for question to fill out when the question cannot be submitted
        onCannotSubmit: function() {},

        //This preserves the state of the users answers for returning or showing the users answer
        storeUserAnswer: function() {
            this.model.set('_userAnswer', this.model.get('_selectedItem').value);
        },

        isCorrect: function() {
            var numberOfCorrectAnswers = 0;

            _.each(this.model.get('_items'), function(item, index) {
                if(item.selected && item.correct)  {
                    this.model.set('_isAtLeastOneCorrectSelection', true);
                    numberOfCorrectAnswers++;
                }
            }, this);

            this.model.set('_numberOfCorrectAnswers', numberOfCorrectAnswers);

            return this.model.get('_isAtLeastOneCorrectSelection') ? true : false;
        },

        // Used to set the score based upon the _questionWeight
        setScore: function() {
            var numberOfCorrectAnswers = this.model.get('_numberOfCorrectAnswers');
            var questionWeight = this.model.get('_questionWeight');
            var score = questionWeight * numberOfCorrectAnswers;
            this.model.set('_score', score);
        },

        // This is important and should give the user feedback on how they answered the question
        // Normally done through ticks and crosses by adding classes
        showMarking: function() {
            this.$('.slider-item').removeClass('correct incorrect')
                .addClass(this.model.get('_selectedItem').correct ? 'correct' : 'incorrect');
        },

        isPartlyCorrect: function() {
            return this.model.get('_isAtLeastOneCorrectSelection');
        },

        // Used by the question view to reset the stored user answer
        resetUserAnswer: function() {
            this.model.set({
                _selectedItem: {},
                _userAnswer: undefined
            });
        },

        // Used by the question view to reset the look and feel of the component.
        // This could also include resetting item data
        resetQuestion: function() {
            this.selectItem(0);
            this.animateToPosition(0);
            this.resetControlStyles();
            this.showScaleMarker(true);
            this.setAltText(this.model.get('_scaleStart'));
        },

        setScalePositions: function() {
            var numberOfItems = this.model.get('_items').length;
            _.each(this.model.get('_items'), function(item, index) {
                var normalisedPosition = this.normalise(index, 0, numberOfItems -1);
                this.$('.slider-scale-number').eq(index).data('normalisedPosition', normalisedPosition);
            }, this);
        },

        showScale: function () {
            this.$('.slider-markers').empty();
            if (this.model.get('_showScale') === false) {
                this.$('.slider-markers').eq(0).css({display: 'none'});
                this.model.get('_showScaleIndicator')
                    ? this.$('.slider-scale-numbers').eq(0).css({visibility: 'hidden'})
                    : this.$('.slider-scale-numbers').eq(0).css({display: 'none'});
            } else {
                var $scaler = this.$('.slider-scaler');
                var $markers = this.$('.slider-markers');
                for (var i = 0, count = this.model.get('_items').length; i < count; i++) {
                    $markers.append("<div class='slider-line component-item-color'>");
                    $('.slider-line', $markers).eq(i).css({left: this.mapIndexToPixels(i, $scaler) + 'px'});
                }
                var scaleWidth = $scaler.width(),
                    $numbers = this.$('.slider-scale-number');
                for (var i = 0, count = this.model.get('_items').length; i < count; i++) {
                    var $number = $numbers.eq(i),
                        newLeft = Math.round($number.data('normalisedPosition') * scaleWidth);
                    $number.css({left: newLeft});
                }
            }
        },

        //Labels are enabled in slider.hbs. Here we manage their containing div.
        showLabels: function () {
            if(!this.model.get('labelStart') && !this.model.get('labelEnd')) {
                this.$('.slider-scale-labels').eq(0).css({display: 'none'});
            }
        },

        remapSliderBar: function() {
            var $scaler = this.$('.slider-scaler');
            var currentIndex = this.getIndexFromValue(this.model.get('_selectedItem').value);
            this.$('.slider-handle').css({left: this.mapIndexToPixels(currentIndex, $scaler) + 'px'});
            this.$('.slider-scale-marker').css({left: this.mapIndexToPixels(currentIndex, $scaler) + 'px'});
            this.$('.slider-bar').width(this.mapIndexToPixels(currentIndex, $scaler));
        },

        onScreenSizeChanged: function() {
            this.showScale();
            this.showLabels();
            this.remapSliderBar();
            if (this.$('.slider-widget.user .button.model').css('display') === 'inline-block') {
                this.hideCorrectAnswer();
            } else if (this.$('.slider-widget.model .button.user ').css('display') === 'inline-block') {
                this.showCorrectAnswer();
            }
        },

        showCorrectAnswer: function() {
            var answers = [];
            var bottom = this.model.get('_correctRange')._bottom;
            var top = this.model.get('_correctRange')._top;
            var range = top - bottom;
            var correctAnswer = this.model.get('_correctAnswer');

            this.showScaleMarker(false);

            if (correctAnswer) {
                // Check that correctAnswer is neither undefined nor empty
                answers.push(correctAnswer);
            } else if (bottom !== undefined) {
                for (var i = 0; i <= range; i++) {
                  answers.push(this.model.get('_items')[this.getIndexFromValue(bottom) + i].value);
                }
            } else {
                console.log(this.constructor + "::WARNING: no correct answer or correct range set in JSON")
            }
            var middleAnswer = answers[Math.floor(answers.length / 2)];
            this.animateToPosition(this.mapIndexToPixels(this.getIndexFromValue(middleAnswer)));
            this.showModelAnswers(answers);
        },

        showModelAnswers: function(correctAnswerArray) {
            var $parentDiv = this.$('.slider-modelranges');
            _.each(correctAnswerArray, function(correctAnswer, index) {
                $parentDiv.append($("<div class='slider-model-answer component-item-color component-item-text-color'>"));

                var $element = $(this.$('.slider-modelranges .slider-model-answer')[index]),
                    startingLeft = this.mapIndexToPixels(this.getIndexFromValue(this.model.get('_selectedItem').value));

                if(this.model.get('_showNumber')) $element.html(correctAnswer);

                $element.css({left:startingLeft}).fadeIn(0, _.bind(function() {
                    $element.animate({left: this.mapIndexToPixels(this.getIndexFromValue(correctAnswer))});
                }, this));
            }, this);
        },

        // Used by the question to display the users answer and
        // hide the correct answer
        // Should use the values stored in storeUserAnswer
        hideCorrectAnswer: function() {
            var userAnswerIndex = this.getIndexFromValue(this.model.get('_userAnswer'));
            this.$('.slider-modelranges').empty();

            this.showScaleMarker(true);
            this.selectItem(userAnswerIndex);
            this.animateToPosition(this.mapIndexToPixels(userAnswerIndex));
        },

        // according to given item index this should make the item as selected
        selectItem: function(itemIndex) {
            this.$el.a11y_selected(false);
            _.each(this.model.get('_items'), function(item, index) {
                item.selected = (index == itemIndex);
                if(item.selected) {
                    this.model.set('_selectedItem', item);
                    this.$('.slider-scale-number[data-id="'+(itemIndex+1)+'"]').a11y_selected(true);
                }
            }, this);
            this.showNumber(true);
        },

        // this should reset the selected state of each item
        deselectAllItems: function() {
            _.each(this.model.get('_items'), function(item) {
                item.selected = false;
            }, this);
        },

        // this makes the marker visible or hidden
        showScaleMarker: function(show) {
            var $scaleMarker = this.$('.slider-scale-marker');
            if (this.model.get('_showScaleIndicator')) {
                this.showNumber(show);
                if(show) {
                    $scaleMarker.addClass('display-block');
                } else {
                    $scaleMarker.removeClass('display-block');
                }
            }
        },

        // this should add the current slider value to the marker
        showNumber: function(show) {
            var $scaleMarker = this.$('.slider-scale-marker');
            if(this.model.get('_showNumber')) {
                if(show) {
                    $scaleMarker.html(this.model.get('_selectedItem').value);
                } else {
                    $scaleMarker.html = "";
                }
            }
        },

        /**
        * Used by adapt-contrib-spoor to get the user's answers in the format required by the cmi.interactions.n.student_response data field
        */
        getResponse:function() {
            return this.model.get('_userAnswer').toString();
        },

        /**
        * Used by adapt-contrib-spoor to get the type of this question in the format required by the cmi.interactions.n.type data field
        */
        getResponseType:function() {
            return "numeric";
        }

    });

    Adapt.register('slider', Slider);

    return Slider;
});

define('components/adapt-contrib-text/js/adapt-contrib-text',['require','coreViews/componentView','coreJS/adapt'],function(require) {

    var ComponentView = require('coreViews/componentView');
    var Adapt = require('coreJS/adapt');

    var Text = ComponentView.extend({

        preRender: function() {
            // Checks to see if the text should be reset on revisit
            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.setReadyStatus();

            // Check if instruction or title or body is set, otherwise force completion
            var cssSelector = this.$('.component-instruction').length > 0
                ? '.component-instruction'
                : (this.$('.component-title').length > 0 
                ? '.component-title' 
                : (this.$('.component-body').length > 0 
                ? '.component-body' 
                : null));

            if (!cssSelector) {
                this.setCompletionStatus();
            } else {
                this.model.set('cssSelector', cssSelector);
                this.$(cssSelector).on('inview', _.bind(this.inview, this));
            }
        },

        // Used to check if the text should reset on revisit
        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$(this.model.get('cssSelector')).off('inview');
                    this.setCompletionStatus();
                }
            }
        }

    });

    Adapt.register('text', Text);

    return Text;

});

define('components/adapt-contrib-textInput/js/adapt-contrib-textInput',['require','coreViews/questionView','coreJS/adapt'],function(require) {
    var QuestionView = require('coreViews/questionView');
    var Adapt = require('coreJS/adapt');

    var genericAnswerIndexOffset = 65536;

    var TextInput = QuestionView.extend({
        events: {
            "focus input":"clearValidationError"
        },

        resetQuestionOnRevisit: function() {
            this.setAllItemsEnabled(false);
            this.resetQuestion();
        },

        setupQuestion: function() {
            this.model.set( '_genericAnswerIndexOffset', genericAnswerIndexOffset );
            this.setupItemIndexes();
            this.restoreUserAnswer();

            this.setupRandomisation();
        },

        setupRandomisation: function() {
            if (this.model.get('_isRandom') && this.model.get('_isEnabled')) {
                this.model.set("_items", _.shuffle(this.model.get("_items")));
            }
        },

        setupItemIndexes: function() {
            
            _.each(this.model.get('_items'), function(item, index) {

                if (item._index === undefined) item._index = index;
                if (item._answerIndex === undefined) item._answerIndex = -1;

            });

        },

        restoreUserAnswer: function() {
            if (!this.model.get("_isSubmitted")) return;

            var userAnswer = this.model.get("_userAnswer");
            var genericAnswers = this.model.get("_answers");
            _.each(this.model.get("_items"), function(item) {
                var answerIndex = userAnswer[item._index];
                if (answerIndex >= genericAnswerIndexOffset) {
                    item.userAnswer = genericAnswers[answerIndex - genericAnswerIndexOffset];
                    item._answerIndex = answerIndex;
                } else if (answerIndex > -1) {
                    item.userAnswer = item._answers[answerIndex];
                    item._answerIndex = answerIndex;
                } else {
                    if (item.userAnswer === undefined) item.userAnswer = "******";
                    item._answerIndex = -1;
                }
                if (item.userAnswer instanceof Array) item.userAnswer = item.userAnswer[0];
            });

            this.setQuestionAsSubmitted();
            this.markQuestion();
            this.setScore();
            this.showMarking();
            this.setupFeedback();
        },  

        disableQuestion: function() {
            this.setAllItemsEnabled(false);
        },

        enableQuestion: function() {
            this.setAllItemsEnabled(true);
        },

        setAllItemsEnabled: function(isEnabled) {
            _.each(this.model.get('_items'), function(item, index) {
                var $itemInput = this.$('input').eq(index);

                if (isEnabled) {
                    $itemInput.prop('disabled', false);
                } else {
                    $itemInput.prop('disabled', true);
                }
            }, this);
        },

        onQuestionRendered: function() {
            this.setReadyStatus();
        },

        clearValidationError: function() {
            this.$(".textinput-item-textbox").removeClass("textinput-validation-error");
        },

        // Use to check if the user is allowed to submit the question
        canSubmit: function() {
            var canSubmit = true;
            this.$(".textinput-item-textbox").each(function() {
                if ($(this).val() == "") {
                    canSubmit = false;
                }
            });
            return canSubmit;
        },

        // Blank method for question to fill out when the question cannot be submitted
        onCannotSubmit: function() {
            this.showValidationError();
        },

        showValidationError: function() {
            this.$(".textinput-item-textbox").addClass("textinput-validation-error");
        },

        //This preserve the state of the users answers for returning or showing the users answer
        storeUserAnswer: function() {
            var items = this.model.get('_items');
            _.each(items, function(item, index) {
                item.userAnswer = this.$('.textinput-item-textbox').eq(index).val();
            }, this);

            this.isCorrect();

            var userAnswer = new Array( items.length );
            _.each(items, function(item, index) {
                userAnswer[ item._index ] = item._answerIndex;
            });
            this.model.set("_userAnswer", userAnswer);
        },

        isCorrect: function() {
            if(this.model.get('_answers')) this.markGenericAnswers();
            else this.markSpecificAnswers();
            // do we have any _isCorrect == false?
            return !_.contains(_.pluck(this.model.get("_items"),"_isCorrect"), false);
        },

        // Allows the learner to give answers into any input, ignoring the order.
        // (this excludes any inputs which have their own specific answers).
        markGenericAnswers: function() {
            var numberOfCorrectAnswers = 0;
            var correctAnswers = this.model.get('_answers').slice();
            var usedAnswerIndexes = [];
            _.each(this.model.get('_items'), function(item, itemIndex) {
                _.each(correctAnswers, function(answerGroup, answerIndex) {
                    if(this.checkAnswerIsCorrect(answerGroup, item.userAnswer)) {
                        if (_.indexOf(usedAnswerIndexes, answerIndex) > -1) return;
                        usedAnswerIndexes.push(answerIndex);
                        item._isCorrect = true;
                        item._answerIndex = answerIndex + genericAnswerIndexOffset;
                        numberOfCorrectAnswers++;
                        this.model.set('_numberOfCorrectAnswers', numberOfCorrectAnswers);
                        this.model.set('_isAtLeastOneCorrectSelection', true);
                    }
                }, this);
                if(!item._isCorrect) item._isCorrect = false;
            }, this);
        },

        // Marks any items which have answers specific to it
        // (i.e. item has a _answers array)
        markSpecificAnswers: function() {
            var numberOfCorrectAnswers = 0;
            var numberOfSpecificAnswers = 0;
            _.each(this.model.get('_items'), function(item, index) {
                if(!item._answers) return;
                var userAnswer = item.userAnswer || ""; 
                if (this.checkAnswerIsCorrect(item["_answers"], userAnswer)) {
                    numberOfCorrectAnswers++;
                    item._isCorrect = true;
                    item._answerIndex = _.indexOf(item["_answers"], this.cleanupUserAnswer(userAnswer));
                    this.model.set('_numberOfCorrectAnswers', numberOfCorrectAnswers);
                    this.model.set('_isAtLeastOneCorrectSelection', true);
                } else {
                    item._isCorrect = false;
                    item._answerIndex = -1;
                }
                numberOfSpecificAnswers++;
            }, this);
        },

        checkAnswerIsCorrect: function(possibleAnswers, userAnswer) {
            var uAnswer = this.cleanupUserAnswer(userAnswer);
            var matched = _.filter(possibleAnswers, function(cAnswer){
                return this.cleanupUserAnswer(cAnswer) == uAnswer;
            }, this);
            
            var answerIsCorrect = matched && matched.length > 0;
            if (answerIsCorrect) this.model.set('_hasAtLeastOneCorrectSelection', true);
            return answerIsCorrect;
        },

        cleanupUserAnswer: function(userAnswer) {
            if (this.model.get('_allowsAnyCase')) {
                userAnswer = userAnswer.toLowerCase();
            }
            if (this.model.get('_allowsPunctuation')) {
                userAnswer = userAnswer.replace(/[\.,-\/#!$£%\^&\*;:{}=\-_`~()]/g, "");
                //remove any orphan double spaces and replace with single space (B & Q)->(B  Q)->(B Q)
                userAnswer = userAnswer.replace(/(  +)+/g, " ");
            }
            // removes whitespace from beginning/end (leave any in the middle)
            return $.trim(userAnswer);
        },

        // Used to set the score based upon the _questionWeight
        setScore: function() {
            var numberOfCorrectAnswers = this.model.get('_numberOfCorrectAnswers');
            var questionWeight = this.model.get("_questionWeight");
            var itemLength = this.model.get('_items').length;

            var score = questionWeight * numberOfCorrectAnswers / itemLength;

            this.model.set('_score', score);
        },

        // This is important and should give the user feedback on how they answered the question
        // Normally done through ticks and crosses by adding classes
        showMarking: function() {
            _.each(this.model.get('_items'), function(item, i) {
                var $item = this.$('.textinput-item').eq(i);
                $item.removeClass('correct incorrect').addClass(item._isCorrect ? 'correct' : 'incorrect');
            }, this);
        },

        isPartlyCorrect: function() {
            return this.model.get('_isAtLeastOneCorrectSelection');
        },

        resetUserAnswer: function() {
            _.each(this.model.get('_items'), function(item) {
                item["_isCorrect"] = false;
                item["userAnswer"] = "";
            }, this);
        },

        // Used by the question view to reset the look and feel of the component.
        resetQuestion: function() {
            this.$('.textinput-item-textbox').prop('disabled', !this.model.get('_isEnabled')).val('');

            this.model.set({
                _isAtLeastOneCorrectSelection: false,
                _isCorrect: undefined
            });
        },

        showCorrectAnswer: function() {
            
            if(this.model.get('_answers'))  {
                
                var correctAnswers = this.model.get('_answers');
                _.each(this.model.get('_items'), function(item, index) {
                    this.$(".textinput-item-textbox").eq(index).val(correctAnswers[index][0]);
                }, this);
                
            } else {
                _.each(this.model.get('_items'), function(item, index) {
                    this.$(".textinput-item-textbox").eq(index).val(item._answers[0]);
                }, this);
            }
            
        },

        hideCorrectAnswer: function() {
            _.each(this.model.get('_items'), function(item, index) {
                this.$(".textinput-item-textbox").eq(index).val(item.userAnswer);
            }, this);
        },

        /**
        * used by adapt-contrib-spoor to get the user's answers in the format required by the cmi.interactions.n.student_response data field
        * returns the user's answers as a string in the format "answer1[,]answer2[,]answer3"
        * the use of [,] as an answer delimiter is from the SCORM 2004 specification for the fill-in interaction type
        */
        getResponse: function() {
            return _.pluck(this.model.get('_items'), 'userAnswer').join('[,]');
        },

        /**
        * used by adapt-contrib-spoor to get the type of this question in the format required by the cmi.interactions.n.type data field
        */
        getResponseType: function() {
            return "fill-in";
        }
    });

    Adapt.register("textinput", TextInput);

    return TextInput;
});

define('menu/adapt-contrib-boxMenu/js/adapt-contrib-boxmenu',[
    'coreJS/adapt',
    'coreViews/menuView'
], function(Adapt, MenuView) {

    var BoxMenuView = MenuView.extend({

        postRender: function() {
            var nthChild = 0;
            this.model.getChildren().each(function(item) {
                if (item.get('_isAvailable')) {
                    nthChild++;
                    item.set("_nthChild", nthChild);
                    this.$('.menu-container-inner').append(new BoxMenuItemView({model: item}).$el);
                }
            });
        }

    }, {
        template: 'boxmenu'
    });

    var BoxMenuItemView = MenuView.extend({

        events: {
            'click button' : 'onClickMenuItemButton'
        },

        className: function() {
            var nthChild = this.model.get("_nthChild");
            return [
                'menu-item',
                'menu-item-' + this.model.get('_id') ,
                this.model.get('_classes'),
                'nth-child-' + nthChild,
                nthChild % 2 === 0 ? 'nth-child-even' : 'nth-child-odd'
            ].join(' ');
        },

        preRender: function() {
            this.model.checkCompletionStatus();
            this.model.checkInteractionCompletionStatus();
        },

        postRender: function() {
            var graphic = this.model.get('_graphic');
            if (graphic && graphic.src && graphic.src.length > 0) {
                this.$el.imageready(_.bind(function() {
                    this.setReadyStatus();
                }, this));
            } else {
                this.setReadyStatus();
            }
        },

        onClickMenuItemButton: function(event) {
            if(event && event.preventDefault) event.preventDefault();
            Backbone.history.navigate('#/id/' + this.model.get('_id'), {trigger: true});
        }

    }, {
        template: 'boxmenu-item'
    });

    Adapt.on('router:menu', function(model) {

        $('#wrapper').append(new BoxMenuView({model: model}).$el);

    });

});

define('theme/adapt-contrib-vanilla/js/theme-block',['require','coreJS/adapt','backbone'],function(require) {
	
	var Adapt = require('coreJS/adapt');
	var Backbone = require('backbone');

	var ThemeBlockView = Backbone.View.extend({

		initialize: function() {
			this.setStyles();
			this.listenTo(Adapt, 'device:resize', this.setStyles);
			this.listenTo(Adapt, 'remove', this.remove);
		},

		setStyles: function() {
			this.setBackground();
			this.setMinHeight();
			this.setDividerBlock();
		},

		setBackground: function() {
			var backgroundColor = this.model.get('_themeBlockConfig')._backgroundColor;
			
			if (backgroundColor) {
				this.$el.addClass(backgroundColor);
			}
		},

		setMinHeight: function() {
			var minHeight = 0;
			var minHeights = this.model.get('_themeBlockConfig')._minimumHeights;

			if (minHeights) {

				if(Adapt.device.screenSize == 'large') {
					minHeight = minHeights._large;
				} else if (Adapt.device.screenSize == 'medium') {
					minHeight = minHeights._medium;
				} else {
					minHeight = minHeights._small;
				}
			}

			this.$el.css({
				minHeight: minHeight + "px"
			});
		},

		setDividerBlock: function() {
			var dividerBlock = this.model.get('_themeBlockConfig')._isDividerBlock;

			if (dividerBlock) {
				this.$el.addClass('divider-block');
			}
		}
	});

	return ThemeBlockView;
	
});

define('theme/adapt-contrib-vanilla/js/vanilla',['require','coreJS/adapt','backbone','theme/adapt-contrib-vanilla/js/theme-block'],function(require) {
	
	var Adapt = require('coreJS/adapt');
	var Backbone = require('backbone');
	var ThemeBlock = require('theme/adapt-contrib-vanilla/js/theme-block');

	// Block View
	// ==========

	Adapt.on('blockView:postRender', function(view) {
		var theme = view.model.get('_theme');
		
		if (theme) {
			new ThemeBlock({
				model: new Backbone.Model({
					_themeBlockConfig: theme
				}),
				el: view.$el
			});
		}
	});
});

define('bundles',[
	"extensions/adapt-contrib-assessment/js/adapt-assessmentArticleExtension",
	"extensions/adapt-contrib-bookmarking/js/adapt-contrib-bookmarking",
	"extensions/adapt-contrib-pageLevelProgress/js/adapt-contrib-pageLevelProgress",
	"extensions/adapt-contrib-resources/js/adapt-contrib-resources",
	"extensions/adapt-contrib-spoor/js/adapt-contrib-spoor",
	"extensions/adapt-contrib-trickle/js/adapt-contrib-trickle",
	"extensions/adapt-contrib-tutor/js/adapt-contrib-tutor",
	"components/adapt-contrib-accordion/js/adapt-contrib-accordion",
	"components/adapt-contrib-assessmentResults/js/adapt-contrib-assessmentResults",
	"components/adapt-contrib-blank/js/adapt-contrib-blank",
	"components/adapt-contrib-gmcq/js/adapt-contrib-gmcq",
	"components/adapt-contrib-graphic/js/adapt-contrib-graphic",
	"components/adapt-contrib-hotgraphic/js/adapt-contrib-hotgraphic",
	"components/adapt-contrib-matching/js/adapt-contrib-matching",
	"components/adapt-contrib-mcq/js/adapt-contrib-mcq",
	"components/adapt-contrib-media/js/adapt-contrib-media",
	"components/adapt-contrib-narrative/js/adapt-contrib-narrative",
	"components/adapt-contrib-slider/js/adapt-contrib-slider",
	"components/adapt-contrib-text/js/adapt-contrib-text",
	"components/adapt-contrib-textInput/js/adapt-contrib-textInput",
	"menu/adapt-contrib-boxMenu/js/adapt-contrib-boxmenu",
	"theme/adapt-contrib-vanilla/js/vanilla"
],function(){});

//# sourceMappingURL=bundles.js.map