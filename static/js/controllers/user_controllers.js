(function() {
  'use strict';

  var module = angular.module(
    'communityshare.controllers.user',
    [
      'communityshare.services.user',
      'communityshare.directives.user',
      'communityshare.directives.institutions',
      'angularFileUpload'
    ]);

  // User Views
  
  module.controller(
    'UserController',
    function($scope, $routeParams, User, Session, Question, Conversation,
             Evnt, startConversation) {
      $scope.Session = Session;
      var userId = $routeParams.userId;
      var userPromise = User.get(userId);
      $scope.message = 'Loading user...';
      $scope.startConversation = startConversation;
      userPromise.then(
        function(user) {
          $scope.message = '';
          $scope.user = user;
          if ($scope.communityPartnerViewMethods.onUserUpdate) {
            $scope.communityPartnerViewMethods.onUserUpdate(user);
          }
          if ($scope.educatorViewMethods.onUserUpdate) {
            $scope.educatorViewMethods.onUserUpdate(user);
          }
        },
        function(response) {
          $scope.message = 'Could not find user with id=' + userId;
        });
      $scope.communityPartnerViewMethods = {};
      $scope.educatorViewMethods = {};
      var question_types = [];
      var questionsPromise = Question.get_many_with_answers(
        userId,
        {'question_type.in': ['signup_community_partner', 'signup', 'signup_educator']}
      );
      if ($scope.Session.activeUser && $scope.Session.activeUser.is_administrator) {
        var conversationsPromise = Conversation.get_many({user_id: userId});
        conversationsPromise.then(
          function(conversations) {
            $scope.conversations = conversations;
          });
        var eventsPromise = Evnt.get_many({user_id: userId});
        eventsPromise.then(
          function(events) {
            $scope.events = events;
          });
      }
      questionsPromise.then(
        function(questions) {
          $scope.questions = [];
          for (var i=0; i<questions.length; i++) {
            var question = questions[i];
            if (question.answer.text) {
              $scope.questions.push(question);
            }
          }
        });
    });

  // User Signups

  var commonSignupLogic = function($scope, user, search, Messages, $location,
                                   $q, Question, Answer) {
    $scope.user = user;
    $scope.search = search;
    $scope.institutionMethods = {};

    // Get questions to display during signup.
    $scope.questions = [];
    var questionsPromise = Question.get_many({
      'question_type.in': ['signup_community_partner', 'signup', 'signup_educator']
    });
    questionsPromise.then(
      function(questions) {
        $scope.questions = questions;
        for (var i=0; i<$scope.questions.length; i++) {
          var question = $scope.questions[i];
          question.answer = new Answer({question_id: question.id});
        }
      });

    $scope.submit = function() {
      // Save changes made to user.
      var userPromise = user.save();
      var allPromises = [userPromise];
      // And save the answers to questions.
      for (var i=0; i<$scope.questions.length; i++) {
        var question = $scope.questions[i];
        if (question.answer.text) {
          allPromises.push(question.answer.save());
        }
      }
      $q.all(allPromises).then(
        function(data) {
          var search = data[0];
          $location.path('/signup/personal');
        },
        function(message) {
          Messages.error(message);
        });

      $scope.readyToSubmit = function() {
        var ready = false;
        if ($scope.institutionMethods.isValid && $scope.institutionMethods.isValid()) {
          ready = true;
        }
        return ready;
      };
    };
  };

  module.controller(
    'SignupCommunityPartnerController',
    function($scope, Session, Messages, $location, $q, Search,
             Question, Answer) {
      $scope.Session = Session;
      var user = Session.activeUser;
      var search;
      if (user) {
        search = user.community_partner_profile_search;
      }
      $scope.isCommunityPartner = true;
      // Signup logic common to Community Partners and Educators
      commonSignupLogic($scope, user, search, Messages, $location, $q,
                       Question, Answer);
    });
  
  module.controller(
    'SignupPersonalController',
    function($scope, Session, $fileUploader, $http, $location) {
      $scope.Session = Session;
      $scope.user = Session.activeUser;
      if (Session.activeUser) {
        $scope.user.wants_update_emails = true;
        $scope.submit = function() {
          var userPromise = $scope.user.save();
          userPromise.then(
            function(user) {
              $location.path('matches');
            },
            function(errorMessage) {
              $scope.errorMessage = errorMessage;
            });
        };
        $scope.validImage = true;
        var uploader = $scope.uploader = $fileUploader.create({
          scope: $scope,
          url: '/api/user/'+$scope.user.id+'/picture',
          headers: $http.defaults.headers.common,
          filters: [
            function (item) {
              var is_image = (item.type.substring(0, 5) == 'image');
              $scope.validImage = is_image;
              uploader.queue.splice(0, uploader.queue.length);
              return is_image;
            }
          ]
        });
        
        // Make sure we only have one file in the uploader queue
        uploader.bind('afteraddingfile', function (event, item) {
          if (uploader.queue.length > 1) {
            uploader.queue.splice(0, uploader.queue.length-1);
          }
        });
      }
    });

  module.controller(
    'SignupEducatorController',
    function($scope, Session, Messages, $location, $q, Search,
            Question, Answer) {
      $scope.Session = Session;
      var user = Session.activeUser;
      var search;
      if (user) {
        search = user.educator_profile_search;
      }
      $scope.isEducator = true;
      $scope.questions = [];
      // Signup logic common to Community Partners and Educators
      commonSignupLogic($scope, user, search, Messages, $location, $q,
                       Question, Answer);
    });

  // Settings Controller

  module.controller(
    'SettingsController',
    function($scope, $location, Session, Messages, $q,
             Question, Answer, $fileUploader, $http, makeDialog, Authenticator, $rootScope) {

      var justSaved = false;

      var turnOffLocationChangeHandler;

      var onLocationChange = function(event, newUrl, oldUrl) {
        if (!justSaved && (($scope.personalSettingsForm && $scope.personalSettingsForm.$dirty) || 
            ($scope.accountSettingsForm && $scope.accountSettingsForm.$dirty) || 
            ($scope.user.community_partner_profile_search &&
             $scope.user.community_partner_profile_search.dirty) ||
            ($scope.user.educator_profile_search &&
             $scope.user.educator_profile_search.dirty)))
        {
          var title = 'Changes not Saved';
          var msg = 'Do you really want to leave this page without saving your changes?';
          var btns = [{result:'yes', label: 'Yes'},
                      {result:'no', label: 'No', cssClass: 'btn-primary'}];
          var d = makeDialog(title, msg, btns);
          d.result.then(
            function(result) {
              if (result === 'yes') {
                turnOffLocationChangeHandler();
                var relUrl = newUrl.replace(/^.*\#/, "");
                $location.path(relUrl);
              }
            });
          event.preventDefault();
        }
      };

      turnOffLocationChangeHandler = $rootScope.$on('$locationChangeStart', onLocationChange);

      $scope.Session = Session;
      if (!Session.activeUser) {
        return;
      }
      $scope.user = Session.activeUser;
      $scope.isCommunityPartner = $scope.user.is_community_partner;
      $scope.isEducator = $scope.user.is_educator;
      $scope.properties = {};
      $scope.settingsTabSet = {};
      // passwordMethods hooks up the password matching directives.
      $scope.passwordMethods = {};
      // Get the questions
      if ($scope.user) {
        var questionsPromise = Question.get_many_with_answers(
          $scope.user.id,
          {'question_type.in': ['signup_community_partner', 'signup_educator']}
        );
        questionsPromise.then(
          function(questions) {
            $scope.questions = questions;
          });
      }

      $scope.$on('personalSettingsForm', function(event, value) {
        $scope.personalSettingsForm = value.personalSettingsForm;
      });
      $scope.$on('accountSettingsForm', function(event, value) {
        $scope.accountSettingsForm = value.accountSettingsForm;
      });

      var onError = function(message) {
        var msg = 'Failed to update settings';
        if (message) {
          msg += ': ' + message;
        }
        $scope.errorMessage = msg;
        $scope.successMessage = '';
      };

      $scope.validImage = true;
      var uploader = $scope.uploader = $fileUploader.create({
        scope: $scope,
        url: '/api/user/'+$scope.user.id+'/picture',
        headers: $http.defaults.headers.common,
        filters: [
          function (item) {
            var is_image = (item.type.substring(0, 5) == 'image');
            $scope.validImage = is_image;
            uploader.queue.splice(0, uploader.queue.length);
            return is_image;
          }
        ]
      });

      // Make sure we only have one file in the uploader queue
      uploader.bind('afteraddingfile', function (event, item) {
        if (uploader.queue.length > 1) {
          uploader.queue.splice(0, uploader.queue.length-1);
        }
      });

      $scope.deleteAccount = function() {
        var title = 'Delete Account';
          var msg = 'Do you really want to delete your Community Share account?';
        var btns = [{result:'yes', label: 'Yes'},
                    {result:'no', label: 'No', cssClass: 'btn-primary'}];
        var d = makeDialog(title, msg, btns);
        d.result.then(
          function(result) {
            if (result === 'yes') {
              var deletePromise = Session.activeUser.destroy();
              deletePromise.then(
                function() {
                  Authenticator.clean();
                  $location.path('/');
                },
                function(message) {
                    Messages.error(message);
                });
            }
          });
      };

      $scope.resendEmailConfirmation = function() {
        var emailConfirmPromise = Authenticator.requestConfirmEmail();
        emailConfirmPromise.then(
          function() {
            Messages.info('Sent email confirmation email.');
          },
          function(errorMessage) {
            Messages.error(errorMessage);
          });
      };

      $scope.save = function() {
        var saveUserPromise = $scope.user.save();
        var savedImages = uploader.uploadAll();
        var allPromises = [saveUserPromise];
        if ($scope.questions) {
          var saveAnswerPromises = [];
          for (var i=0; i<$scope.questions.length; i++) {
            var answer = $scope.questions[i].answer;
            if (answer.text) {
              var saveAnswerPromise = answer.save();
              saveAnswerPromises.push(saveAnswerPromise);
              allPromises.push(saveAnswerPromise);
            }
          }
        }
        var combinedPromise = $q.all(allPromises);
        saveUserPromise.then(
          function(user) {
            Session.activeUser.updateFromData(user.toData());
          },
          onError);
        combinedPromise.then(
          function() {
            justSaved = true;
            $location.path('/');
          });
      };
      
    });

})();
