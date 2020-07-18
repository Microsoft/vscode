.PHONY: all
all: echo hello

.PHONY: hello
hello: main.o factorial.o \
       hello.o $(first) $($(filter second,second)) \
       # This is a long \
         comment inside prerequisites.
	g++ main.o factorial.o hello.o -o hello

# There are a building steps \
	below. And the tab is at the beginning of this line.

main.o: main.cpp
	g++ -c main.cpp

factorial.o: factorial.cpp
	g++ -c factorial.cpp $(fake_variable)

hello.o: hello.cpp \
					$(Colorizing with tabs at the beginning of the second line of prerequisites)
	g++ -c hello.cpp -o $@

.PHONY: clean
clean:
	rm *o hello

.PHONY: var
var:
	# "$$" in a shell means to escape makefile's variable substitution.
	some_shell_var=$$(sed -nre 's/some regex with (group)/\1/p')

.PHONY: echo
echo:
	echo "#" and '#' in quotes are not comments \
		and '\' will be continued
	@echo Shell is not printed out, just a message.
	@-+-+echo Error will be ignored here; invalidcommand
	# And we can see variables are highlited as supposed to be:
	@echo '$(CC) $(shell echo "123") -o $@'
	@-./point-and-slash-should-not-be-highlighted

define defined
  $(info Checking existance of $(1) $(flavor $(1)))
  $(if $(filter undefined,$(flavor $(1))),0,1)
endef

ifeq ($(strip $(call defined,TOP_DIR)),0)
  $(info TOP_DIR must be set before including paths.mk)
endif

-include $(TOP_DIR)3rdparty.mk

ifeq ($(strip $(call defined,CODIT_DIR)),0)
  $(info CODIT_DIR must be set in $(TOP_DIR)3rdparty.mk)
endif

CXXVER_GE480 := $(shell expr `$(CXX) -dumpversion | sed -e 's/\.\([0-9][0-9]\)/\1/g' -e 's/\.\([0-9]\)/0\1/g' -e 's/^[0-9]\{3,4\}$$/&00/'` \>= 40800)

ok := ok
$(info Braces {} in parentheses ({}): ${ok})
${info Parentheses () in braces {()}: $(ok)}

ifeq ("${ok}", "skip")
  $(ok))}
  ${ok}})
endif

result != echo "'$(ok)' $(shell echo "from inlined shell")"
$(info $(result))

# Below is a test of variable assignment without any spacing.
var=val
var?=val
var:=123
var!=echo val
var:=val \
notvar=butval
var:=$(val:.c=.o)

var-$(nested-var)=val

# Spaces in a nested shell will hurt a colorizing of variable,
# but not so much.
var-$(shell printf 2) := val2
$(info Should be 'val2' here: $(var-2))

export a ?= b:c
